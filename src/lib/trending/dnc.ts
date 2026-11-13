import { normalizeSubject } from "./subjects";

// FTC Do Not Call complaints → daily counts. Phone numbers and cities are
// dropped here and never stored (callers are often spoofed numbers).

export type DncRecord = {
  attributes: { subject?: string | null; "recorded-message-or-robocall"?: string | null } & Record<string, unknown>;
};

export type DncCount = { subject: string; robocall: boolean; complaints: number };

export function aggregateDnc(records: DncRecord[]): DncCount[] {
  const counts = new Map<string, DncCount>();
  for (const { attributes } of records) {
    const subject = normalizeSubject(attributes.subject) || "No Subject Provided";
    const robocall = String(attributes["recorded-message-or-robocall"] ?? "").toUpperCase() === "Y";
    const key = `${robocall}|${subject}`;
    const existing = counts.get(key);
    if (existing) existing.complaints++;
    else counts.set(key, { subject, robocall, complaints: 1 });
  }
  return [...counts.values()].sort((a, b) => b.complaints - a.complaints || a.subject.localeCompare(b.subject));
}

/** YYYY-MM-DD for `daysAgo` days before `today` (both calendar dates). */
export function shiftDate(today: string, daysAgo: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export type IngestStatus = { day: string; total: number; fetched_at: string };

/**
 * Fetched recently enough to skip on a repeat run. Days with zero complaints
 * are never "done": zero usually means the FTC hasn't published that day yet.
 */
export function isFresh(row: IngestStatus | undefined, now: Date, freshHours: number): boolean {
  if (!row || row.total <= 0) return false;
  return now.getTime() - Date.parse(row.fetched_at) < freshHours * 3_600_000;
}

/**
 * Days to fetch per area code: anything missing in the last `windowDays`
 * (ending yesterday), plus the most recent `refreshDays` again (late complaints
 * can still arrive) unless they were fetched recently. Ordered newest day first
 * across all area codes, so every area code gets recent data before any one of
 * them backfills.
 */
export function daysToFetch(
  today: string,
  areaCodes: string[],
  ingested: ({ area_code: string } & Partial<IngestStatus> & { day: string })[],
  windowDays = 14,
  refreshDays = 2,
  options: { now?: Date; freshHours?: number } = {},
): { areaCode: string; day: string }[] {
  const byKey = new Map(ingested.map((d) => [`${d.area_code}|${d.day}`, d]));
  const result: { areaCode: string; day: string }[] = [];
  for (let ago = 1; ago <= windowDays; ago++) {
    const day = shiftDate(today, ago);
    for (const areaCode of areaCodes) {
      const row = byKey.get(`${areaCode}|${day}`);
      const recent =
        options.now !== undefined &&
        options.freshHours !== undefined &&
        row?.total !== undefined &&
        row.fetched_at !== undefined &&
        isFresh(row as IngestStatus, options.now, options.freshHours);
      const refresh = ago <= refreshDays && !recent;
      if (!row || refresh) result.push({ areaCode, day });
    }
  }
  return result;
}

/** States whose every day in [fromDay, toDay] is fresh can be skipped this run. */
export function statesNeedingFetch(
  states: string[],
  status: ({ state: string } & IngestStatus)[],
  fromDay: string,
  toDay: string,
  now: Date,
  freshHours: number,
): string[] {
  const byKey = new Map(status.map((s) => [`${s.state}|${s.day}`, s]));
  return states.filter((state) => {
    for (let d = toDay; d >= fromDay; d = shiftDate(d, 1)) {
      if (!isFresh(byKey.get(`${state}|${d}`), now, freshHours)) return true;
    }
    return false;
  });
}

/**
 * Least recently fetched first (never fetched before anything), keeping the
 * given order for ties. States a short day didn't reach lead the next day.
 */
export function orderByLastFetched(states: string[], status: ({ state: string } & IngestStatus)[]): string[] {
  const last = new Map<string, number>();
  for (const s of status) last.set(s.state, Math.max(last.get(s.state) ?? -Infinity, Date.parse(s.fetched_at)));
  const at = (state: string) => last.get(state) ?? -Infinity;
  return [...states].sort((a, b) => (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1));
}

/** YYYY-MM-DD from an FTC created-date ("2026-10-21 13:45:12"); null if malformed. */
export function recordDay(record: DncRecord): string | null {
  const value = String(record.attributes["created-date"] ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** Keep only complaints whose consumer-state matches (blank states are dropped). */
export function fromState(records: DncRecord[], stateFullName: string): DncRecord[] {
  const want = stateFullName.toLowerCase();
  return records.filter((r) => String(r.attributes["consumer-state"] ?? "").trim().toLowerCase() === want);
}

/**
 * Per-state streams come back newest first. After reading some pages, a day is
 * complete if we've seen anything older than it, or reached the end of the data.
 * Returns the days in [fromDay, toDay] that are complete.
 */
export function completeDays(fromDay: string, toDay: string, oldestSeen: string | null, reachedEnd: boolean): string[] {
  const days: string[] = [];
  for (let d = toDay; d >= fromDay; d = shiftDate(d, 1)) {
    if (reachedEnd || (oldestSeen !== null && d > oldestSeen)) days.push(d);
  }
  return days;
}

/** Group records by created day, keeping days within [fromDay, toDay]. */
export function bucketByDay(records: DncRecord[], fromDay: string, toDay: string): Map<string, DncRecord[]> {
  const byDay = new Map<string, DncRecord[]>();
  for (const record of records) {
    const day = recordDay(record);
    if (!day || day < fromDay || day > toDay) continue;
    const list = byDay.get(day) ?? [];
    list.push(record);
    byDay.set(day, list);
  }
  return byDay;
}
