"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CodeInput } from "@/components/code-input";
import { suggestScamType } from "@/lib/classify";
import { defang } from "@/lib/redaction";
import { foundSummary } from "@/lib/redaction/summary";
import { DRAFT_KEY, LAST_ZIP_KEY, parseDraft, saveDraft, type StoredDraft } from "@/lib/report-draft";
import { DESCRIPTION_MAX } from "@/lib/report-schema";
import { CHANNELS, SCAM_TYPES, toScamType, type Channel, type ScamType } from "@/lib/scam-types";
import { reportAction, type ReportState } from "./actions";
import { reportSignIn, type ReportSignInState } from "./sign-in-actions";

const inputClass = "block w-full min-h-12 rounded-md border-2 border-border bg-background px-3 text-lg";
const primaryButton =
  "inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-5 text-lg font-bold text-accent-foreground disabled:opacity-60";
const linkButton = "inline-flex min-h-11 items-center underline";

function FieldError({ messages }: { messages?: string[] }) {
  return messages?.length ? <span className="block text-danger">{messages[0]}</span> : null;
}

// --- Browser storage (redacted draft and last browsed zip only) ---------------
const noopSubscribe = () => () => {};
function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
let draftRaw: string | null | undefined;
let draftValue: StoredDraft | null = null;
function draftSnapshot(): StoredDraft | null {
  const raw = localStore()?.getItem(DRAFT_KEY) ?? null;
  if (raw !== draftRaw) {
    draftRaw = raw;
    draftValue = parseDraft(raw);
  }
  return draftValue;
}
const zipSnapshot = () => localStore()?.getItem(LAST_ZIP_KEY) ?? "";
const clearDraft = () => localStore()?.removeItem(DRAFT_KEY);

type Props = { signedIn: boolean; defaultZip: string; hasHomeZip: boolean };

export function ReportForm({ signedIn, defaultZip, hasHomeZip }: Props) {
  const [state, action, pending] = useActionState<ReportState, FormData>(reportAction, { step: "draft", version: 0 });
  const restored = useSyncExternalStore(noopSubscribe, draftSnapshot, () => null);
  const storedZip = useSyncExternalStore(noopSubscribe, zipSnapshot, () => "");
  const [isSignedIn, setIsSignedIn] = useState(signedIn);
  const [wantsSignIn, setWantsSignIn] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const postRef = useRef<HTMLButtonElement>(null);
  const postAfterSignIn = useRef(false);

  // Keep the latest redacted draft on this device (never the raw text).
  useEffect(() => {
    if (state.step !== "preview") return;
    try {
      const store = localStore();
      if (store) saveDraft(store, state.draft);
    } catch {
      // Storage blocked: the draft just won't survive a reload.
    }
  }, [state]);

  // After signing in inside the flow, post right away.
  useEffect(() => {
    if (isSignedIn && postAfterSignIn.current) {
      postAfterSignIn.current = false;
      formRef.current?.requestSubmit(postRef.current ?? undefined);
    }
  }, [isSignedIn]);

  const usingRestored = state.version === 0 && restored !== null;

  if (state.step === "preview" || usingRestored) {
    const draft =
      state.step === "preview"
        ? state.draft
        : {
            channel: restored!.channel as Channel,
            scamType: toScamType(restored!.scamType),
            zip: restored!.zip,
            description: restored!.description,
          };
    const serverState = state.step === "preview" ? state : null;
    const showSignIn = !isSignedIn && (wantsSignIn || Boolean(serverState?.signInRequired));

    return (
      <div className="space-y-6">
        <form ref={formRef} key={state.version} action={action} className="space-y-6">
          <input type="hidden" name="channel" value={draft.channel} />
          <input type="hidden" name="scamType" value={draft.scamType} />
          <input type="hidden" name="zip" value={draft.zip} />

          <h2 className="text-2xl font-bold">Check before posting</h2>
          {usingRestored && (
            <p role="status" className="rounded-md border-2 border-border bg-surface p-4">
              We restored your draft from earlier on this device.
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-bold">How</dt>
            <dd>{CHANNELS[draft.channel]}</dd>
            <dt className="font-bold">Kind</dt>
            <dd>{SCAM_TYPES[draft.scamType].label}</dd>
            <dt className="font-bold">Where</dt>
            <dd>Near {draft.zip}</dd>
          </dl>
          {isSignedIn && !hasHomeZip && (
            <p className="text-muted">We&apos;ll use this zip for your alerts. Change it in Settings.</p>
          )}

          {serverState?.notice && (
            <p role="alert" className="rounded-md border-2 border-accent p-4 font-bold">
              {serverState.notice}
            </p>
          )}
          {serverState && !serverState.notice && <p role="status">{foundSummary(serverState.found)}</p>}

          <label className="block space-y-2">
            <span className="block font-bold">This is what neighbors will see</span>
            <span className="block text-muted">
              Edit anything that could identify you or someone else, like a name, address, or account number.
            </span>
            <textarea
              name="description"
              defaultValue={draft.description}
              rows={8}
              maxLength={DESCRIPTION_MAX}
              className={`${inputClass} py-2`}
            />
            <FieldError messages={serverState?.errors?.description} />
          </label>
          {defang(draft.description) !== draft.description && (
            <p className="text-muted">Links will be shown like example[.]com and won&apos;t be clickable.</p>
          )}

          <FieldError messages={serverState?.errors?.form} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {isSignedIn ? (
              <button ref={postRef} type="submit" name="intent" value="post" disabled={pending} className={primaryButton}>
                {pending ? "Posting…" : "Post report"}
              </button>
            ) : (
              <button type="button" onClick={() => setWantsSignIn(true)} disabled={showSignIn} className={primaryButton}>
                Post report
              </button>
            )}
            <button type="submit" name="intent" value="back" disabled={pending} className={linkButton}>
              Go back
            </button>
            <button
              type="submit"
              name="intent"
              value="discard"
              formNoValidate
              disabled={pending}
              onClick={clearDraft}
              className={linkButton}
            >
              Discard draft
            </button>
          </div>
          {!isSignedIn && (
            <p className="text-muted">
              You&apos;ll confirm your email when you post. Until then, this draft (with personal details hidden) is kept
              on this device. Discard it if you&apos;re on a shared computer.
            </p>
          )}
        </form>

        {showSignIn && (
          <SignInPanel
            onSignedIn={() => {
              postAfterSignIn.current = true;
              setIsSignedIn(true);
            }}
          />
        )}
      </div>
    );
  }

  const { values, errors } = state;
  return (
    <form key={state.version} action={action} className="space-y-6">
      <MessageAndType
        initialDescription={values?.description ?? ""}
        initialType={values?.scamType}
        error={errors?.description}
        typeError={errors?.scamType}
      />

      <fieldset className="space-y-2">
        <legend className="font-bold">How did they contact you?</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.entries(CHANNELS) as [Channel, string][]).map(([key, label]) => (
            <label
              key={key}
              className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-md border-2 border-border px-3 has-checked:border-accent has-checked:font-bold"
            >
              <input type="radio" name="channel" value={key} defaultChecked={values?.channel === key} className="size-5" />
              {label}
            </label>
          ))}
        </div>
        <FieldError messages={errors?.channel} />
      </fieldset>

      <label className="block space-y-2">
        <span className="block font-bold">Zip code where it happened</span>
        <input
          key={`zip-${storedZip}`}
          name="zip"
          defaultValue={values?.zip ?? (defaultZip || storedZip)}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          className={`${inputClass} w-40`}
        />
        <FieldError messages={errors?.zip} />
      </label>

      <p className="text-muted">
        Please follow the{" "}
        <Link href="/rules" className="underline">
          community rules
        </Link>
        : no names of private people and no personal details.
      </p>
      <FieldError messages={errors?.form} />
      <button type="submit" name="intent" value="preview" disabled={pending} className={primaryButton}>
        {pending ? "Checking…" : "Preview"}
      </button>
    </form>
  );
}

/** "What happened?" first, with a type suggested from the text (only when confident). */
function MessageAndType({
  initialDescription,
  initialType,
  error,
  typeError,
}: {
  initialDescription: string;
  initialType?: string;
  error?: string[];
  typeError?: string[];
}) {
  const [description, setDescription] = useState(initialDescription);
  const [chosen, setChosen] = useState<ScamType | null>(initialType ? toScamType(initialType) : null);
  const [picking, setPicking] = useState(false);
  const suggestion = suggestScamType(description);
  const type = chosen ?? suggestion.type;

  return (
    <div className="space-y-4">
      <label className="block space-y-2">
        <span className="block font-bold">What happened?</span>
        <span className="block text-muted">
          Paste the message, or describe the call or visit. Next, you&apos;ll see a preview with phone numbers, emails,
          names, and other personal details hidden.
        </span>
        <textarea
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={DESCRIPTION_MAX}
          className={`${inputClass} py-2`}
        />
        <FieldError messages={error} />
      </label>

      {picking ? (
        <label className="block space-y-2">
          <span className="block font-bold">What kind of scam?</span>
          <select
            name="scamType"
            value={type}
            onChange={(e) => setChosen(e.target.value as ScamType)}
            className={inputClass}
          >
            {(Object.entries(SCAM_TYPES) as [ScamType, { label: string }][]).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>
          <input type="hidden" name="scamType" value={type} />
          <span aria-live="polite">
            {!chosen && suggestion.confident ? "Looks like: " : "Kind: "}
            <strong>{SCAM_TYPES[type].label}</strong>
          </span>{" "}
          <button type="button" onClick={() => setPicking(true)} className="-my-3 inline-block py-3 underline">
            Change
          </button>
        </p>
      )}
      <FieldError messages={typeError} />
    </div>
  );
}

/** Email + 6-digit code, inside the report flow so the draft stays on the page. */
function SignInPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const [state, act, pending] = useActionState<ReportSignInState, FormData>(async (prev, formData) => {
    const result = await reportSignIn(prev, formData);
    if (result.signedIn) onSignedIn();
    return result;
  }, { step: "email" });

  return (
    <section aria-labelledby="report-sign-in" className="space-y-4 rounded-2xl border-2 border-accent bg-surface p-4 sm:p-6">
      <h2 id="report-sign-in" className="text-xl font-bold">
        Confirm your email to post
      </h2>
      {state.signedIn ? (
        <p role="status">Signed in. Posting your report…</p>
      ) : state.step === "email" ? (
        <form action={act} className="space-y-3">
          <p>No password needed. We&apos;ll email you a 6-digit code.</p>
          <label className="block space-y-2">
            <span className="block font-bold">Email address</span>
            <input name="email" type="email" autoComplete="email" required autoFocus className={inputClass} />
          </label>
          {state.error && (
            <p role="alert" className="text-danger">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Sending…" : "Send code"}
          </button>
          <p className="text-muted">
            By posting you agree to the{" "}
            <Link href="/terms" className="underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline">
              Privacy policy
            </Link>
            .
          </p>
        </form>
      ) : (
        <form action={act} className="space-y-3">
          <p role="status">
            We sent a code to <strong>{state.email}</strong>. Enter it here; your draft stays on this page.
          </p>
          <label className="block space-y-2">
            <span className="block font-bold">Code from the email</span>
            <CodeInput className={inputClass} submitIntent="verify" disabled={pending} autoFocus />
          </label>
          {state.error && (
            <p role="alert" className="text-danger">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <button type="submit" name="intent" value="verify" disabled={pending} className={primaryButton}>
              {pending ? "Checking…" : "Sign in and post"}
            </button>
            <button type="submit" name="intent" value="restart" formNoValidate disabled={pending} className={linkButton}>
              Use a different email
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
