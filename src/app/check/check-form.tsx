"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ClusterCard } from "@/components/cluster-card";
import { GENERAL_WARNING_SIGNS, tipsFor } from "@/lib/scam-types";
import { check, type CheckState } from "./actions";

const inputClass = "block w-full min-h-12 rounded-md border-2 border-border bg-background px-3 text-lg";

export function CheckForm({ defaultZip, signedIn }: { defaultZip: string; signedIn: boolean }) {
  const [state, action, pending] = useActionState<CheckState, FormData>(check, { status: "idle" });
  const values = state.values ?? { text: "", zip: defaultZip };
  const errors = state.status === "error" ? state.errors : undefined;

  return (
    <div className="space-y-8">
      <form action={action} className="space-y-4">
        <label className="block space-y-2">
          <span className="block font-bold">Paste the message, or describe the call or visit</span>
          <textarea name="text" defaultValue={values.text} rows={6} maxLength={2000} className={`${inputClass} py-2`} />
          {errors?.text && <span className="block text-danger">{errors.text[0]}</span>}
        </label>
        <label className="block space-y-2">
          <span className="block font-bold">Your zip code (optional)</span>
          <span className="block text-muted">We look for similar reports within 50 miles. Leave blank to search everywhere.</span>
          <input
            name="zip"
            defaultValue={values.zip}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            className={`${inputClass} w-40`}
          />
          {errors?.zip && <span className="block text-danger">{errors.zip[0]}</span>}
        </label>
        {errors?.form && (
          <p role="alert" className="text-danger">
            {errors.form[0]}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 items-center rounded-md bg-accent px-5 text-lg font-bold text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Checking…" : "Check"}
        </button>
        <p className="text-muted">We don&apos;t save what you paste here.</p>
      </form>

      {state.status === "result" && <CheckResult state={state} signedIn={signedIn} />}
    </div>
  );
}

function CheckResult({ state, signedIn }: { state: Extract<CheckState, { status: "result" }>; signedIn: boolean }) {
  const query = state.zip && !signedIn ? `?zip=${state.zip}` : "";

  if (state.matches.length === 0) {
    return (
      <section role="status" className="space-y-3 rounded-md border-2 border-border p-4">
        <h2 className="text-2xl font-bold">We didn&apos;t find a match {state.zip ? "nearby" : ""}</h2>
        <p>That doesn&apos;t mean it&apos;s safe. Watch for these common warning signs:</p>
        <ul className="list-disc space-y-1 pl-6">
          {GENERAL_WARNING_SIGNS.map((sign) => (
            <li key={sign}>{sign}</li>
          ))}
        </ul>
        <p>If it looks like a scam, report it so neighbors can watch for it.</p>
        <NextStepsLink />
      </section>
    );
  }

  const tips = tipsFor(state.matches[0].scam_type, state.matches[0].latest_channel);
  return (
    <section role="status" className="space-y-4">
      <div className="space-y-2 rounded-md border-2 border-accent p-4">
        <h2 className="text-2xl font-bold">Neighbors reported something similar</h2>
        <p>This looks like what others reported. We can&apos;t be certain, so be careful.</p>
        <ul className="list-disc space-y-1 pl-6">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </div>
      <NextStepsLink />
      <ul className="space-y-4">
        {state.matches.map((match) => (
          <ClusterCard
            key={match.cluster_id}
            cluster={match}
            viewerZip={state.zip}
            href={`/alerts/${match.cluster_id}${query}`}
          />
        ))}
      </ul>
    </section>
  );
}

function NextStepsLink() {
  return (
    <p>
      Already paid or shared personal details?{" "}
      <Link href="/next-steps" className="underline">
        Here&apos;s what to do first
      </Link>
      .
    </p>
  );
}
