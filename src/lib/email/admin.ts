import { defang } from "@/lib/redaction";
import { criterionMark, evaluatePilot, METRIC_GROUPS, weekLabel, type PilotSummary, type WeeklyMetrics } from "@/lib/pilot";
import { SITE_NAME } from "@/lib/site";
import { COLORS, escapeHtml, group, paragraph, renderEmail, rows, type EmailBlock, type EmailContent, type RenderedEmail } from "./layout";

export type AdminEmail = Omit<EmailContent, "footer">;

/** Where to look when FTC ingest or trend coverage has problems. */
export const INGEST_RUNS_URL = "https://github.com/hawl3y/byebell/actions/workflows/ingest.yml";

export function renderAdminEmail(siteUrl: string, email: AdminEmail): RenderedEmail {
  return renderEmail(siteUrl, {
    ...email,
    footer: [paragraph(`You're getting this because you're a ${SITE_NAME} admin.`)],
  });
}

export function list(items: string[]): EmailBlock {
  return {
    html: `<ul style="margin:0 0 16px;padding-left:22px">${items.map((i) => `<li style="margin:0 0 8px">${escapeHtml(i)}</li>`).join("")}</ul>`,
    text: items.map((i) => `- ${i}`).join("\n"),
  };
}

/** Monday summary: the targets first, then last full week's numbers by group. `weeks` is newest first. */
export function weeklySummaryEmail(summary: PilotSummary, weeks: WeeklyMetrics[], siteUrl: string): AdminEmail | null {
  const last = weeks[1];
  if (!last) return null;
  const targets = evaluatePilot(summary, weeks);
  return {
    subject: `${SITE_NAME} weekly summary: week of ${weekLabel(last.week_start)}`,
    heading: `Week of ${weekLabel(last.week_start)}`,
    blocks: [
      group("Pilot targets", [
        {
          html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px">${targets
            .map(
              (c) =>
                `<tr><td style="padding:12px 12px 12px 0;border-bottom:1px solid ${COLORS.border};vertical-align:top;width:24px;font-size:20px;font-weight:700;color:${c.met === null ? COLORS.muted : c.met ? "#15803d" : "#b91c1c"}">${criterionMark(c.met)}</td><td style="padding:12px 0;border-bottom:1px solid ${COLORS.border}"><span style="font-weight:700">${escapeHtml(c.label)}</span><br><span style="color:${COLORS.muted}">${escapeHtml(c.progress)}</span></td></tr>`,
            )
            .join("")}</table>`,
          text: targets.map((c) => `${criterionMark(c.met)} ${c.label}: ${c.progress}`).join("\n"),
        },
      ]),
      ...METRIC_GROUPS.map((g) => group(g.heading, [rows(g.metrics.map(([key, label]) => [label, last[key]]))])),
      paragraph(`${summary.total_signups} accounts in total.`, undefined, { muted: true }),
    ],
    button: { label: "View dashboard", url: `${siteUrl}/admin/metrics` },
  };
}

const REASON_LABELS: Record<string, string> = {
  personal_info: "Shares personal info",
  private_person: "Names a private person",
  not_a_scam: "Not a scam",
  spam: "Spam or fake",
  other: "Something else",
};

export function flagEmail(reason: string, hidden: boolean, description: string, siteUrl: string): AdminEmail {
  const excerpt = defang(description).slice(0, 500);
  return {
    subject: hidden ? "A report was auto-hidden after 3 flags" : "A report was flagged",
    heading: hidden ? "A report was auto-hidden" : "A report was flagged",
    blocks: [
      rows([
        ["Reason", REASON_LABELS[reason] ?? reason],
        ["Status", hidden ? "Hidden until you review it" : "Still visible"],
      ]),
      ...(excerpt
        ? [group("The report", [{ html: `<p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(excerpt)}</p>`, text: excerpt }])]
        : []),
    ],
    button: { label: "Review reports", url: `${siteUrl}/admin` },
  };
}
