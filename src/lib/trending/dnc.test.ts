import { describe, expect, it } from "vitest";
import { aggregateDnc, bucketByDay, completeDays, daysToFetch, fromState, isFresh, orderByLastFetched, recordDay, shiftDate, statesNeedingFetch } from "./dnc";

describe("orderByLastFetched", () => {
  const row = (state: string, day: string, fetched_at: string) => ({ state, day, total: 5, fetched_at });

  it("puts never-fetched states first, then the least recently fetched", () => {
    const status = [
      row("AL", "2026-11-12", "2026-11-13T17:05:00Z"),
      row("GA", "2026-11-11", "2026-11-12T20:40:00Z"),
      row("GA", "2026-11-10", "2026-11-12T20:40:00Z"),
      row("CA", "2026-11-12", "2026-11-13T17:10:00Z"),
      row("CA", "2026-11-11", "2026-11-12T17:10:00Z"),
    ];
    expect(orderByLastFetched(["AL", "CA", "GA", "ME"], status)).toEqual(["ME", "GA", "AL", "CA"]);
  });

  it("keeps the given order for ties", () => {
    expect(orderByLastFetched(["NY", "AL", "ME"], [])).toEqual(["NY", "AL", "ME"]);
  });
});

describe("aggregateDnc", () => {
  const records = [
    { attributes: { subject: "Computer  & technical support", "recorded-message-or-robocall": "Y", "company-phone-number": "8005551234", "consumer-city": "Nyack" } },
    { attributes: { subject: "Computer & technical support", "recorded-message-or-robocall": "Y", "company-phone-number": "8005550000" } },
    { attributes: { subject: "Computer & technical support", "recorded-message-or-robocall": "N" } },
    { attributes: { subject: "", "recorded-message-or-robocall": "" } },
  ];

  it("counts by normalized subject and robocall flag", () => {
    expect(aggregateDnc(records)).toEqual([
      { subject: "Computer & technical support", robocall: true, complaints: 2 },
      { subject: "Computer & technical support", robocall: false, complaints: 1 },
      { subject: "No Subject Provided", robocall: false, complaints: 1 },
    ]);
  });

  it("never carries phone numbers or cities forward", () => {
    const json = JSON.stringify(aggregateDnc(records));
    expect(json).not.toMatch(/800555|Nyack|phone|city/i);
  });
});

describe("daysToFetch", () => {
  it("shifts calendar dates across months", () => {
    expect(shiftDate("2026-11-01", 1)).toBe("2026-10-31");
  });

  it("fetches missing days and always refreshes the last two", () => {
    const ingested = [
      { area_code: "845", day: "2026-10-22" },
      { area_code: "845", day: "2026-10-21" },
      { area_code: "845", day: "2026-10-20" },
    ];
    const days = daysToFetch("2026-10-23", ["845"], ingested, 4, 2).map((d) => d.day);
    // Window: 10-22, 10-21 (refresh), 10-20 (have), 10-19 (missing).
    expect(days).toEqual(["2026-10-22", "2026-10-21", "2026-10-19"]);
  });

  it("interleaves area codes newest day first, so one code can't starve the others", () => {
    const days = daysToFetch("2026-10-23", ["845", "201", "551"], [], 2, 1);
    expect(days).toEqual([
      { areaCode: "845", day: "2026-10-22" },
      { areaCode: "201", day: "2026-10-22" },
      { areaCode: "551", day: "2026-10-22" },
      { areaCode: "845", day: "2026-10-21" },
      { areaCode: "201", day: "2026-10-21" },
      { areaCode: "551", day: "2026-10-21" },
    ]);
  });
});


describe("per-state stream helpers", () => {
  const rec = (date: string, state = "New Jersey") => ({ attributes: { "created-date": date, "consumer-state": state } });

  it("reads days and skips malformed dates", () => {
    expect(recordDay(rec("2026-10-21 13:45:12"))).toBe("2026-10-21");
    expect(recordDay(rec("20261235"))).toBeNull();
    expect(recordDay(rec("11/14/2024"))).toBeNull();
  });

  it("keeps only the requested state and drops blank states", () => {
    const records = [rec("2026-10-21 01:00:00"), rec("2026-10-21 01:00:00", "New York"), rec("2026-10-21 01:00:00", "")];
    expect(fromState(records, "New Jersey")).toHaveLength(1);
  });

  it("buckets records by day within the window", () => {
    const byDay = bucketByDay(
      [rec("2026-10-22 09:00:00"), rec("2026-10-21 09:00:00"), rec("2026-10-21 08:00:00"), rec("2026-10-18 09:00:00")],
      "2026-10-20",
      "2026-10-22",
    );
    expect([...byDay.entries()].map(([d, r]) => [d, r.length])).toEqual([
      ["2026-10-22", 1],
      ["2026-10-21", 2],
    ]);
  });

  it("marks a day complete only once something older has been seen", () => {
    // Read down to 10-21: 10-22 and 10-23 are complete, 10-21 might continue on the next page.
    expect(completeDays("2026-10-20", "2026-10-23", "2026-10-21", false)).toEqual(["2026-10-23", "2026-10-22"]);
    expect(completeDays("2026-10-20", "2026-10-23", "2026-10-19", false)).toEqual([
      "2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20",
    ]);
    expect(completeDays("2026-10-20", "2026-10-21", null, true)).toEqual(["2026-10-21", "2026-10-20"]);
    expect(completeDays("2026-10-20", "2026-10-21", null, false)).toEqual([]);
  });
});

describe("skipping work already done (frequent scheduled runs)", () => {
  const now = new Date("2026-10-24T19:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it("treats recent days with complaints as fresh, and zero days as not done", () => {
    expect(isFresh({ day: "2026-10-23", total: 40, fetched_at: hoursAgo(1) }, now, 6)).toBe(true);
    expect(isFresh({ day: "2026-10-23", total: 40, fetched_at: hoursAgo(7) }, now, 6)).toBe(false);
    expect(isFresh({ day: "2026-10-23", total: 0, fetched_at: hoursAgo(1) }, now, 6)).toBe(false);
    expect(isFresh(undefined, now, 6)).toBe(false);
  });

  it("skips refresh days fetched recently, but still fills missing days", () => {
    const ingested = [
      { area_code: "201", day: "2026-10-23", total: 50, fetched_at: hoursAgo(1) },
      { area_code: "201", day: "2026-10-22", total: 0, fetched_at: hoursAgo(1) },
    ];
    const days = daysToFetch("2026-10-24", ["201"], ingested, 3, 3, { now, freshHours: 6 }).map((d) => d.day);
    // 10-23 is fresh (skipped); 10-22 had zero (re-check); 10-21 is missing.
    expect(days).toEqual(["2026-10-22", "2026-10-21"]);
  });

  it("skips states whose whole window is fresh", () => {
    const fresh = (state: string, day: string, total = 10) => ({ state, day, total, fetched_at: hoursAgo(1) });
    const status = [
      fresh("NJ", "2026-10-23"), fresh("NJ", "2026-10-22"), fresh("NJ", "2026-10-21"),
      fresh("NY", "2026-10-23"), fresh("NY", "2026-10-22"),
      fresh("WY", "2026-10-23", 0), fresh("WY", "2026-10-22"), fresh("WY", "2026-10-21"),
    ];
    expect(statesNeedingFetch(["NJ", "NY", "WY", "CA"], status, "2026-10-21", "2026-10-23", now, 6)).toEqual([
      "NY", // missing 10-21
      "WY", // zero day re-checked
      "CA", // never fetched
    ]);
  });
});
