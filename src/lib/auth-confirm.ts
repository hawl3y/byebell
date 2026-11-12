import type { EmailOtpType } from "@supabase/supabase-js";

// Only the types our sign-in email sends (supabase/templates/sign-in.html), so
// a link can't be replayed as a recovery, invite, or email-change token.
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>(["email"]);

export type ConfirmParams =
  | { kind: "code"; code: string }
  | { kind: "otp"; tokenHash: string; type: EmailOtpType }
  | { kind: "invalid"; reason: string };

/** Sign-in link query parameters. Supabase still verifies the code or token itself. */
export function parseConfirmParams(params: URLSearchParams): ConfirmParams {
  const code = params.get("code");
  if (code) return { kind: "code", code };

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type) {
    if (!ALLOWED_OTP_TYPES.has(type as EmailOtpType)) return { kind: "invalid", reason: `unsupported type ${type}` };
    return { kind: "otp", tokenHash, type: type as EmailOtpType };
  }
  return { kind: "invalid", reason: params.get("error_description") ?? "missing code or token_hash" };
}
