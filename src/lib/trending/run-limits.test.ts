import { describe, expect, it } from "vitest";
import { canStartRequest, FUNCTION_LIMIT_MS, HARD_STOP_MS, REQUEST_TIMEOUT_MS } from "./run-limits";

describe("run limits", () => {
  it("only starts a request that can time out before the hard stop", () => {
    const start = 1_000_000;
    const stopAt = start + HARD_STOP_MS;
    expect(canStartRequest(start, stopAt)).toBe(true);
    expect(canStartRequest(stopAt - REQUEST_TIMEOUT_MS, stopAt)).toBe(true);
    expect(canStartRequest(stopAt - REQUEST_TIMEOUT_MS + 1, stopAt)).toBe(false);
  });

  it("leaves at least 30 s after the hard stop for the last save and the response", () => {
    expect(FUNCTION_LIMIT_MS - HARD_STOP_MS).toBeGreaterThanOrEqual(30_000);
  });
});
