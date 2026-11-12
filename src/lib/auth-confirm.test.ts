import { describe, expect, it } from "vitest";
import { parseConfirmParams } from "./auth-confirm";

const p = (query: string) => parseConfirmParams(new URLSearchParams(query));

describe("parseConfirmParams", () => {
  it("accepts a PKCE code", () => {
    expect(p("code=abc")).toEqual({ kind: "code", code: "abc" });
  });

  it("accepts the token type our sign-in email sends", () => {
    expect(p("token_hash=h1&type=email")).toEqual({ kind: "otp", tokenHash: "h1", type: "email" });
  });

  it("rejects any other token type", () => {
    for (const type of ["recovery", "invite", "email_change", "signup", "magiclink", "EMAIL", "email ", ""]) {
      expect(p(`token_hash=h1&type=${encodeURIComponent(type)}`).kind, type).toBe("invalid");
    }
  });

  it("is invalid without a code or a token hash and type", () => {
    expect(p("")).toEqual({ kind: "invalid", reason: "missing code or token_hash" });
    expect(p("token_hash=h1")).toEqual({ kind: "invalid", reason: "missing code or token_hash" });
    expect(p("type=email")).toEqual({ kind: "invalid", reason: "missing code or token_hash" });
    expect(p("error_description=Email+link+is+invalid")).toEqual({ kind: "invalid", reason: "Email link is invalid" });
  });
});
