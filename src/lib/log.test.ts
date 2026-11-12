import { describe, expect, it } from "vitest";
import { sanitizeForLog } from "./log";

describe("sanitizeForLog", () => {
  it("removes line breaks and control characters so values can't forge log lines", () => {
    const forged = "bad link\r\n2026-11-12 ERROR admin signed in\u2028x\u2029y\u0000\u001b[31m\t";
    const out = sanitizeForLog(forged);
    expect(out).not.toMatch(/[\r\n\u2028\u2029\u0000\u001b\t]/);
    expect(out).toBe("bad link  2026-11-12 ERROR admin signed in x y  [31m ");
  });

  it("caps length", () => {
    expect(sanitizeForLog("a".repeat(500))).toBe(`${"a".repeat(200)}…`);
  });

  it("leaves ordinary text alone and handles non-strings", () => {
    expect(sanitizeForLog("Email link is invalid or has expired")).toBe("Email link is invalid or has expired");
    expect(sanitizeForLog(null)).toBe("");
    expect(sanitizeForLog(42)).toBe("42");
  });
});
