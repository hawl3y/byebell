// The run budget is checked between work items, but a market day can be many
// pages. These hard limits keep every run under the 300 s function limit
// (maxDuration on Vercel Hobby with Fluid compute): no FTC request starts
// unless it can time out by HARD_STOP_MS, leaving time for the last save.
export const REQUEST_TIMEOUT_MS = 15_000;
export const HARD_STOP_MS = 270_000;
export const FUNCTION_LIMIT_MS = 300_000;

export function canStartRequest(now: number, stopAt: number): boolean {
  return now + REQUEST_TIMEOUT_MS <= stopAt;
}
