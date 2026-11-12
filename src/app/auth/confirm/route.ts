import { NextResponse, type NextRequest } from "next/server";
import { postLoginPath } from "@/lib/auth";
import { parseConfirmParams } from "@/lib/auth-confirm";
import { sanitizeForLog } from "@/lib/log";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// Sign-in link landing. Two shapes are supported:
// - ?token_hash=…&type=… : our custom template (supabase/templates/sign-in.html).
//   Works in any browser.
// - ?code=… : Supabase's default email ({{ .ConfirmationURL }}), used if the
//   custom template isn't installed. Needs the PKCE code verifier cookie, so
//   the link must open in the browser that requested it.
export async function GET(request: NextRequest) {
  const params = parseConfirmParams(request.nextUrl.searchParams);

  const supabase = await createClient();
  let error: { message: string } | null = null;

  if (params.kind === "code") {
    ({ error } = await supabase.auth.exchangeCodeForSession(params.code));
  } else if (params.kind === "otp") {
    ({ error } = await supabase.auth.verifyOtp({ type: params.type, token_hash: params.tokenHash }));
  } else {
    error = { message: params.reason };
  }

  if (error) {
    console.error("sign-in link failed", sanitizeForLog(error.message));
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  // Started signing in from the report flow: go back to the (saved) draft.
  const returnTo = request.cookies.get("byebell_return_to")?.value;
  const path = returnTo ? safeNext(returnTo) : await postLoginPath("/");
  const response = NextResponse.redirect(new URL(path, request.url));
  if (returnTo) response.cookies.delete("byebell_return_to");
  return response;
}
