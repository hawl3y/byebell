import { after, NextResponse, type NextRequest } from "next/server";
import { notifyAdmins } from "@/lib/alerts/admin-notify";
import { easternDate } from "@/lib/alerts/policy";
import { isCronRequest } from "@/lib/cron-auth";
import { INGEST_RUNS_URL, list } from "@/lib/email/admin";
import { paragraph } from "@/lib/email/layout";
import { SITE_NAME } from "@/lib/site";
import { runIngest } from "@/lib/trending/ingest";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return new NextResponse("Unauthorized", { status: 401 });
  // pg_cron's caller (pg_net) gives up after a few seconds; reply right away and
  // run within this function's lifetime so a dropped connection can't cut the run short.
  if (request.nextUrl.searchParams.get("background") === "1") {
    after(() => ingestAndReport().catch((e) => console.error("ingest failed", e)));
    return NextResponse.json({ started: true }, { status: 202 });
  }
  return NextResponse.json(await ingestAndReport());
}

async function ingestAndReport() {
  const result = await runIngest();
  console.log("ingest", JSON.stringify(result));

  // Runs repeat every 15 minutes on weekday afternoons, so rate limits and partial
  // coverage are expected here; the daily coverage check (digest cron) reports gaps.
  // Only real errors are emailed (at most once a day per key).
  const dnc = result.dnc;
  const problems: string[] = [];
  if ("error" in dnc) problems.push(`FTC: ${dnc.error}`);
  else if (dnc.skipped) {
    if (dnc.reason === "no_api_key") problems.push("FTC: FTC_API_KEY is missing");
  }
  else if (dnc.states.failed > 0) problems.push(`FTC states: ${dnc.states.failed} state(s) failed with a non-rate-limit error`);
  if ("error" in result.ic3) problems.push(`FBI IC3: ${result.ic3.error}`);

  if (problems.length > 0) {
    await notifyAdmins(
      {
        subject: `${SITE_NAME} data import had problems`,
        heading: "Data import had problems",
        blocks: [list(problems), paragraph("The run logs show the full result.")],
        button: { label: "Open ingest runs", url: INGEST_RUNS_URL },
      },
      `ingest-${easternDate(new Date())}`,
    ).catch((e) => console.error("notify failed", e));
  }
  return result;
}
