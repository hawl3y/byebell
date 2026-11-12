import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCluster, getClusterExamples, getMyClusterStatus, getMyExampleState } from "@/lib/clusters";
import { crowdLabel } from "@/lib/crowd";
import { formatDistance, formatTimeAgo } from "@/lib/format";
import { defang } from "@/lib/redaction";
import { CHANNELS, scamTypeInfo, tipsFor } from "@/lib/scam-types";
import { SITE_NAME } from "@/lib/site";
import { createPublicClient } from "@/lib/supabase/public";
import { ClearReportDraft } from "@/components/local-report-data";
import { RecordUsage } from "@/components/record-usage";
import { getViewer } from "@/lib/viewer";
import { CorroborateButton } from "./corroborate-button";
import { ExampleActions } from "./example-actions";
import { ShareButton } from "./share-button";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Link previews show the scam type and counts only, never report text.
async function getPreview(id: string) {
  "use cache";
  cacheLife("minutes");
  if (!UUID.test(id)) return null;
  const { data } = await createPublicClient().rpc("get_cluster", { p_cluster_id: id });
  const cluster = (data as { scam_type: string; report_count: number; corroboration_count: number }[] | null)?.[0];
  if (!cluster) return null;
  return { title: scamTypeInfo(cluster.scam_type).label, description: crowdLabel(cluster.report_count, cluster.corroboration_count) };
}

export async function generateMetadata({ params }: PageProps<"/alerts/[id]">): Promise<Metadata> {
  const preview = await getPreview((await params).id);
  if (!preview) return { title: "Scam alert" };
  const title = `Scam alert: ${preview.title}`;
  const description = `${preview.description}. See what it looks like and what to do.`;
  return { title, description, openGraph: { title, description, type: "article" }, twitter: { card: "summary", title, description } };
}

export default function AlertPage({ params, searchParams }: PageProps<"/alerts/[id]">) {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <AlertCard params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AlertCard({ params, searchParams }: PageProps<"/alerts/[id]">) {
  const [{ id }, { zip, posted, hidden, src, zipsaved }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const emailVisit =
    src === "digest" || src === "instant" ? (
      <RecordUsage metrics={[src === "digest" ? "email_visit_digest" : "email_visit_instant"]} />
    ) : null;

  const viewer = await getViewer(zip);
  const viewerZip = viewer.kind === "located" ? viewer.zip : null;
  const [cluster, examples, status, exampleState] = await Promise.all([
    getCluster(id, viewerZip),
    getClusterExamples(id),
    getMyClusterStatus(id),
    getMyExampleState(id),
  ]);
  const backHref = viewer.kind === "located" && !viewer.signedIn ? `/?zip=${viewer.zip}` : "/";
  const hiddenNotice = hidden ? (
    <p role="status" className="rounded-md border-2 border-accent p-4 font-bold">
      Thanks, this report is hidden pending review.
    </p>
  ) : null;

  if (!cluster) {
    if (!hidden) notFound();
    // The flag hid the only report neighbors could see in this alert.
    return (
      <section className="max-w-3xl space-y-4">
        {emailVisit}
        {hiddenNotice}
        <Link href={backHref} className="inline-flex min-h-12 items-center underline">
          Back to scams near you
        </Link>
      </section>
    );
  }

  const type = scamTypeInfo(cluster.scam_type);
  const distance = formatDistance(cluster.distance_miles, viewerZip !== null && viewerZip === cluster.nearest_zip);
  const meta = [distance, `last reported ${formatTimeAgo(new Date(cluster.last_seen))}`].filter(Boolean).join(" · ");

  return (
    <article className="max-w-3xl space-y-6">
      {emailVisit}
      {hiddenNotice}
      {posted && (
        <div role="status" className="space-y-1 rounded-md border-2 border-accent bg-surface p-4">
          <ClearReportDraft />
          <p className="font-bold">Thanks. Your report is posted and neighbors nearby can see it.</p>
          {zipsaved && (
            <p>
              We&apos;ll use this zip for your alerts.{" "}
              <Link href="/settings" className="underline">
                Change it in Settings
              </Link>
              .
            </p>
          )}
          <p className="text-sm text-muted">
            Know a neighbor who&apos;d want this?{" "}
            <Link href="/flyer" className="underline">
              Print a {SITE_NAME} flyer
            </Link>{" "}
            for your building, library, or community board.
          </p>
        </div>
      )}

      <header className="space-y-1">
        <h1 className="text-3xl font-bold">{type.label}</h1>
        <p className="text-lg font-bold">{crowdLabel(cluster.report_count, cluster.corroboration_count)}</p>
        <p className="text-muted">{meta}</p>
      </header>

      <ShareButton clusterId={cluster.cluster_id} title={type.label} />

      <CorroborateButton clusterId={cluster.cluster_id} status={status} />

      <section className="space-y-3">
        <h2 className="text-xl font-bold">What it looked like</h2>
        <ul className="space-y-3">
          {examples.map((example) => (
            <li key={example.id} className="space-y-2">
              <p className="text-muted">
                {CHANNELS[example.channel]} · {formatTimeAgo(new Date(example.created_at))}
              </p>
              <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-4 border-border bg-foreground/5 p-4">
                {defang(example.description_redacted)}
              </blockquote>
              <ExampleActions reportId={example.id} clusterId={cluster.cluster_id} state={exampleState.get(example.id)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-bold">What to do</h2>
        <ul className="list-disc space-y-1 pl-6">
          {tipsFor(cluster.scam_type, examples[0]?.channel).map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <p>
          Lost money or shared personal details?{" "}
          <Link href="/next-steps" className="underline">
            Here&apos;s what to do first
          </Link>
          .
        </p>
      </section>

      <section className="space-y-2" aria-label="Share this alert">
        <p className="font-bold">Know someone who might get this?</p>
        <ShareButton clusterId={cluster.cluster_id} title={type.label} />
      </section>

      <Link href={backHref} className="inline-flex min-h-12 items-center underline">
        Back to scams near you
      </Link>
    </article>
  );
}
