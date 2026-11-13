import "server-only";
import { easternDate } from "@/lib/alerts/policy";
import { STATE_NAMES } from "@/lib/states";
import { canStartRequest, FUNCTION_LIMIT_MS, HARD_STOP_MS, REQUEST_TIMEOUT_MS } from "@/lib/trending/run-limits";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  aggregateDnc,
  bucketByDay,
  completeDays,
  daysToFetch,
  fromState,
  orderByLastFetched,
  recordDay,
  shiftDate,
  statesNeedingFetch,
  type DncRecord,
  type IngestStatus,
} from "./dnc";
import { parseIc3Rss } from "./ic3";

const DNC_URL = "https://api.ftc.gov/v0/dnc-complaints";
const IC3_RSS_URL = "https://www.ic3.gov/PSA/RSS";
const PAGE_SIZE = 50;
const MAX_PAGES_PER_DAY = 40;
const WINDOW_DAYS = 14;
// The FTC publishes weekdays around noon Eastern; re-fetch recent days so
// late-published complaints are picked up.
const REFRESH_DAYS = 3;
// Per-state streams can't filter by date (the API ignores it), so we read each
// state newest-first, this many days deep. No backfill beyond this.
const STATE_DEPTH_DAYS = 3;
const MAX_STATE_PAGES = 120;
// The key's hourly quota is large, but a stricter burst throttle in front of the
// API (it appears to be per IP, and Vercel shares IPs) rejects rapid requests and
// takes ~10 minutes to recover. So: one request at a time, paced, and stop for
// the day on a 429. Markets run first; states get whatever time is left.
const PACE_MS = 400;
const RUN_TIME_BUDGET_MS = 240_000;
// Scheduled runs repeat every 15 minutes (pg_cron and GitHub Actions) plus a
// daily Vercel cron; skip days and states fetched within this window (see isFresh).
const FRESH_HOURS = 6;
// After a 429, no run calls the FTC for this long: the throttle needs ~10 quiet
// minutes, and requests during that time keep it locked.
const COOLDOWN_MINUTES = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class RateLimitedError extends Error {}
// Out of time or a stalled request: stop like a 429, keeping completed days.
class StopRunError extends RateLimitedError {}

let lastRequestAt = 0;
/** Per run: overlapping runs can share an instance (Fluid compute). */
type Api = { key: string; stopAt: number; throttled: boolean };

async function fetchPage(api: Api, params: Record<string, string>): Promise<DncRecord[]> {
  const wait = lastRequestAt + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  if (!canStartRequest(Date.now(), api.stopAt)) throw new StopRunError("run time limit");
  lastRequestAt = Date.now();
  const url = new URL(DNC_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("items_per_page", String(PAGE_SIZE));
  let res: Response;
  try {
    res = await fetch(url, { headers: { "X-Api-Key": api.key }, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new StopRunError("FTC DNC request timed out");
    throw e;
  }
  // api.data.gov's quota is shared and not always what the headers suggest; treat 429 as "stop for today".
  if (res.status === 429) {
    api.throttled = true;
    throw new RateLimitedError("FTC DNC 429");
  }
  if (!res.ok) throw new Error(`FTC DNC ${res.status}`);
  const body = (await res.json()) as { data?: DncRecord[] | null };
  return body.data ?? [];
}

/** Area code + date filters work together, so markets get exact days. */
async function fetchAreaCodeDay(api: Api, areaCode: string, day: string): Promise<DncRecord[]> {
  const records: DncRecord[] = [];
  for (let page = 0; page < MAX_PAGES_PER_DAY; page++) {
    const items = await fetchPage(api, {
      area_code: areaCode,
      created_date_from: `${day} 00:00:00`,
      created_date_to: `${day} 23:59:59`,
      offset: String(page * PAGE_SIZE),
    });
    records.push(...items);
    // meta.record-total isn't reliable; a short page means we're done.
    if (items.length < PAGE_SIZE) return records;
  }
  throw new Error(`more than ${MAX_PAGES_PER_DAY} pages for ${areaCode} ${day}`);
}

async function ingestMarkets(api: Api, today: string, deadline: number, now: Date) {
  const admin = createAdminClient();
  const { data: markets, error } = await admin.from("markets").select("state, area_codes").eq("active", true);
  if (error) throw new Error(`markets lookup failed: ${error.message}`);
  const stateByAreaCode = new Map<string, string>();
  for (const m of markets ?? []) for (const code of m.area_codes as string[]) stateByAreaCode.set(code, m.state as string);

  const { data: ingested, error: ingestedError } = await admin.rpc("dnc_ingest_status", {
    p_since: shiftDate(today, WINDOW_DAYS),
  });
  if (ingestedError) throw new Error(`dnc_ingest_status failed: ${ingestedError.message}`);

  let days = 0;
  let failed = 0;
  let rateLimited = false;
  const work = daysToFetch(
    today,
    [...stateByAreaCode.keys()],
    ingested as ({ area_code: string } & IngestStatus)[],
    WINDOW_DAYS,
    REFRESH_DAYS,
    { now, freshHours: FRESH_HOURS },
  );
  for (const { areaCode, day } of work) {
    if (Date.now() > deadline) break;
    try {
      // Only complaints from the market's state (blank states are dropped).
      const records = fromState(await fetchAreaCodeDay(api, areaCode, day), STATE_NAMES[stateByAreaCode.get(areaCode)!]);
      const { error: saveError } = await admin.rpc("replace_dnc_day", {
        p_area_code: areaCode,
        p_day: day,
        p_counts: aggregateDnc(records),
        p_total: records.length,
      });
      if (saveError) throw new Error(saveError.message);
      days++;
    } catch (e) {
      // Leave the day unrecorded so the next run retries it.
      console.error("market day failed", areaCode, day, e);
      failed++;
      if (e instanceof RateLimitedError) {
        rateLimited = true;
        break;
      }
    }
  }
  return { days, failed, rateLimited, planned: work.length };
}

/** Read one state's complaints newest-first until older than fromDay (or out of budget). */
async function ingestState(
  api: Api,
  code: string,
  fromDay: string,
  toDay: string,
  takeRequest: () => boolean,
  onRateLimited: () => void,
): Promise<{ days: number; complete: boolean; error?: unknown }> {
  const name = STATE_NAMES[code];
  const records: DncRecord[] = [];
  let oldestSeen: string | null = null;
  let reachedEnd = false;
  let finished = false;
  let fetchError: unknown;

  for (let page = 0; page < MAX_STATE_PAGES; page++) {
    if (!takeRequest()) break;
    let items: DncRecord[];
    try {
      items = await fetchPage(api, { state: name, offset: String(page * PAGE_SIZE) });
    } catch (e) {
      // Keep whatever days are already complete; the rest are refreshed next run.
      if (e instanceof RateLimitedError) onRateLimited();
      fetchError = e;
      break;
    }
    records.push(...items);
    for (const item of items) {
      const day = recordDay(item);
      if (day && (oldestSeen === null || day < oldestSeen)) oldestSeen = day;
    }
    if (items.length < PAGE_SIZE) {
      reachedEnd = true;
      finished = true;
      break;
    }
    if (oldestSeen !== null && oldestSeen < fromDay) {
      finished = true;
      break;
    }
  }

  const days = completeDays(fromDay, toDay, oldestSeen, reachedEnd);
  if (days.length === 0) return { days: 0, complete: false, error: fetchError };

  const byDay = bucketByDay(fromState(records, name), fromDay, toDay);
  const admin = createAdminClient();
  for (const day of days) {
    const dayRecords = byDay.get(day) ?? [];
    const { error } = await admin.rpc("replace_dnc_state_day", {
      p_state: code,
      p_day: day,
      p_counts: aggregateDnc(dayRecords),
      p_total: dayRecords.length,
    });
    if (error) throw new Error(`replace_dnc_state_day failed: ${error.message}`);
  }
  return { days: days.length, complete: finished, error: fetchError };
}

async function ingestStates(api: Api, today: string, deadline: number, priority: string[], now: Date) {
  const toDay = shiftDate(today, 1);
  const fromDay = shiftDate(today, STATE_DEPTH_DAYS);
  const codes = Object.keys(STATE_NAMES);
  const { data, error: statusError } = await createAdminClient().rpc("dnc_state_ingest_status", {
    p_since: fromDay,
  });
  if (statusError) throw new Error(`dnc_state_ingest_status failed: ${statusError.message}`);
  const status = data as ({ state: string } & IngestStatus)[];
  // Market states first (their fallback matters most), then the rest, least
  // recently fetched first, so states a run didn't reach go first next time.
  const ordered = [...new Set([...priority.filter((c) => c in STATE_NAMES), ...orderByLastFetched(codes, status)])];
  const queue = statesNeedingFetch(ordered, status, fromDay, toDay, now, FRESH_HOURS);
  const skipped = ordered.length - queue.length;

  let requests = 0;
  let rateLimited = false;
  const takeRequest = () => (!rateLimited && Date.now() < deadline ? (requests++, true) : false);
  const onRateLimited = () => {
    rateLimited = true;
  };
  let statesComplete = 0;
  let statesPartial = 0;
  let failed = 0;

  for (const code of queue) {
    if (rateLimited || Date.now() >= deadline) break;
    try {
      const result = await ingestState(api, code, fromDay, toDay, takeRequest, onRateLimited);
      if (result.complete) statesComplete++;
      else statesPartial++;
      if (result.error && !(result.error instanceof RateLimitedError)) {
        console.error("state fetch failed", code, result.error);
        failed++;
      }
    } catch (e) {
      console.error("state failed", code, e);
      failed++;
    }
  }
  return { statesComplete, statesPartial, skipped, failed, requests, rateLimited, totalStates: codes.length };
}

async function ingestDnc(now: Date) {
  const apiKey = process.env.FTC_API_KEY;
  if (!apiKey) {
    console.error("FTC_API_KEY missing; skipping Do Not Call ingestion");
    return { skipped: true as const, reason: "no_api_key" as const };
  }
  const admin = createAdminClient();
  const { data: claim, error: claimError } = await admin.rpc("dnc_claim_run", { p_seconds: FUNCTION_LIMIT_MS / 1000 });
  if (claimError) throw new Error(`dnc_claim_run failed: ${claimError.message}`);
  if (claim !== "claimed") return { skipped: true as const, reason: claim as "running" | "cooldown" };

  const api: Api = { key: apiKey, stopAt: Date.now() + HARD_STOP_MS, throttled: false };
  try {
    return await fetchDnc(api, now);
  } finally {
    const { error } = await admin.rpc("dnc_finish_run", { p_cooldown_minutes: api.throttled ? COOLDOWN_MINUTES : 0 });
    if (error) console.error("dnc_finish_run failed", error.message);
  }
}

async function fetchDnc(api: Api, now: Date) {
  const today = easternDate(now);
  const deadline = Date.now() + RUN_TIME_BUDGET_MS;
  const markets = await ingestMarkets(api, today, deadline, now);
  // If the markets already hit the throttle, don't spend more requests today.
  const { data: marketRows } = await createAdminClient().from("markets").select("state").eq("active", true);
  const priority = [...new Set((marketRows ?? []).map((m) => m.state as string))];
  const states = markets.rateLimited
    ? {
        statesComplete: 0,
        statesPartial: 0,
        skipped: 0,
        failed: 0,
        requests: 0,
        rateLimited: true,
        totalStates: Object.keys(STATE_NAMES).length,
      }
    : await ingestStates(api, today, deadline, priority, now);
  return { skipped: false as const, markets, states };
}

async function ingestIc3() {
  const res = await fetch(IC3_RSS_URL, {
    cache: "no-store",
    headers: { "User-Agent": "scam-radar (community scam alerts)" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`IC3 RSS ${res.status}`);
  const headlines = parseIc3Rss(await res.text());
  if (headlines.length === 0) return { headlines: 0 };
  const { error } = await createAdminClient()
    .from("public_scams")
    .upsert(headlines, { onConflict: "url", ignoreDuplicates: true });
  if (error) throw new Error(`public_scams upsert failed: ${error.message}`);
  return { headlines: headlines.length };
}

export async function runIngest(now = new Date()) {
  const [dnc, ic3] = await Promise.allSettled([ingestDnc(now), ingestIc3()]);
  return {
    dnc: dnc.status === "fulfilled" ? dnc.value : { error: String(dnc.reason) },
    ic3: ic3.status === "fulfilled" ? ic3.value : { error: String(ic3.reason) },
  };
}
