import { describe, expect, it } from "vitest";
import { RFP_BID_REPORT as PILOT_REPORT } from "../fixtures/pilot-reports";
import { normalizeText, PLACEHOLDERS, redact } from "./index";
import { checkBeforePost, foundSummary } from "./summary";

// A multi-line report: the textarea posts it back with CRLF line breaks, which
// used to look like a new redaction and loop the Post step forever.
const REPORT =
  "Got a call from 555-123-4567 saying my grandson Tommy was in jail.\n" +
  "He said to pay at secure-bail.com and gave a code 482913.\n\n" +
  "Thanks,\nJohn Smith";

const browserRoundTrip = (s: string) => s.replace(/\n/g, "\r\n");

describe("redaction is idempotent", () => {
  it("leaves its own output unchanged, including placeholders", () => {
    const once = redact(REPORT);
    expect(once.found).toEqual({ phone: 1, name: 2, code: 1 });
    const twice = redact(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.found).toEqual({});
  });

  it("never matches inside or across placeholders", () => {
    const ph = Object.values(PLACEHOLDERS);
    const glues = [" ", " is ", ": ", " #", " ending in ", ", ", "\n", "-", ""];
    for (const a of ph)
      for (const b of ph)
        for (const glue of glues) {
          const s = `Mr. ${a}${glue}${b} account number ${a} 12 Main ${b} Street, my son ${a}`;
          expect(redact(s).found, s).toEqual({});
          expect(redact(s).text, s).toBe(s);
        }
  });

  it("treats CRLF from the browser as no change", () => {
    const shown = redact(REPORT).text;
    expect(redact(browserRoundTrip(shown))).toEqual({ text: shown, found: {} });
  });

  it("strips private-use characters a reporter might paste", () => {
    expect(redact("call  at  0 now").text).toBe("call  at  0 now");
  });
});

describe("checkBeforePost", () => {
  it("posts the previewed text after a browser round trip", () => {
    const shown = redact(REPORT).text;
    const check = checkBeforePost(browserRoundTrip(shown));
    expect(check.notice).toBeUndefined();
    expect(check.text).toBe(shown);
  });

  it("says what it hid when the reporter added details after the preview", () => {
    const edited = `${redact(REPORT).text}\r\nCall me at jane@example.com or 555-987-6543.`;
    const check = checkBeforePost(edited);
    expect(check.found).toEqual({ email: 1, phone: 1 });
    expect(check.notice).toBe("We hid 1 email address, 1 phone number in your edits. Please check it again, then post.");
  });
});

describe("pilot report: RFP bid email", () => {
  it("hides only the sender email and is stable on a second pass", () => {
    const once = redact(PILOT_REPORT);
    expect(once.found).toEqual({ email: 1 });
    expect(once.text).toBe(
      [
        "Invitation to Submit a Project Bid: RFP -D81762",
        "Inbox",
        "",
        "STATE OF NEW YORK <[email]>",
        "8:32 AM (4 hours ago)",
        "to state_of_newyork_bids_list, bcc: me",
        "",
        "The State of New York has invited you to bid on the below project.",
        "",
        "PROJECT OVERVIEW",
        "",
        "Project Id:  RFP -D81762",
        "",
        "Project Starts:  11/19/2026",
        "",
        "Project URL: VIEW PROJECT DETAILS",
        "",
        "Please note: This Bidding Matches Your Business Commodity Code.",
      ].join("\n"),
    );
    expect(redact(once.text)).toEqual({ text: once.text, found: {} });
  });

  it("posts without looping after the browser round trip", () => {
    const shown = redact(PILOT_REPORT).text;
    const check = checkBeforePost(browserRoundTrip(shown));
    expect(check.notice).toBeUndefined();
    expect(check.text).toBe(shown);
  });
});

describe("normalizeText", () => {
  it("trims blank lines at the ends and collapses runs of blank lines to one", () => {
    expect(normalizeText("\n \n\tHi\n\n \n\t\n\nthere\nyou\n \n\n")).toBe("\tHi\n\nthere\nyou");
  });

  it("is idempotent", () => {
    const once = normalizeText(PILOT_REPORT);
    expect(normalizeText(once)).toBe(once);
  });
});

describe("foundSummary", () => {
  it("lists what was hidden, or says nothing was", () => {
    expect(foundSummary({ phone: 2, name: 1 })).toBe("We hid 2 phone numbers, 1 name.");
    expect(foundSummary({})).toBe("We didn't find any personal details to hide.");
  });
});
