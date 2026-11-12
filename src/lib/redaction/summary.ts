import { redact, type RedactionKind, type RedactionResult } from "./index";

const KIND_LABELS: Record<RedactionKind, [string, string]> = {
  phone: ["phone number", "phone numbers"],
  email: ["email address", "email addresses"],
  card: ["card number", "card numbers"],
  account: ["account number", "account numbers"],
  ssn: ["Social Security number", "Social Security numbers"],
  code: ["code", "codes"],
  address: ["address", "addresses"],
  name: ["name", "names"],
};

function listFound(found: RedactionResult["found"]): string {
  return (Object.entries(found) as [RedactionKind, number][])
    .map(([kind, n]) => `${n} ${KIND_LABELS[kind][n === 1 ? 0 : 1]}`)
    .join(", ");
}

export function foundSummary(found: RedactionResult["found"]): string {
  const list = listFound(found);
  return list ? `We hid ${list}.` : "We didn't find any personal details to hide.";
}

export type PostCheck = RedactionResult & { notice?: string };

/**
 * Redacts the text submitted with Post. Only real redactions (counted in
 * `found`) send the reporter back; formatting differences such as CRLF line
 * breaks from the textarea don't, and `text` is the normalized version to save.
 */
export function checkBeforePost(description: string): PostCheck {
  const result = redact(description);
  const list = listFound(result.found);
  return list ? { ...result, notice: `We hid ${list} in your edits. Please check it again, then post.` } : result;
}
