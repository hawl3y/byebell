import { describe, expect, it } from "vitest";
import { suggestScamType } from "./classify";
import { RFP_BID_REPORT } from "./fixtures/pilot-reports";

const s = (t: string) => suggestScamType(t);

describe("suggestScamType", () => {
  it("recognizes each group from typical messages", () => {
    expect(s("USPS: Your package is on hold due to an incomplete address. Update at usps-help.com")).toEqual({ type: "fake_fee", confident: true });
    expect(s("You have an unpaid toll balance of $4.15. Pay now: ezpass-pay.xyz")).toEqual({ type: "fake_fee", confident: true });
    expect(s("This is the IRS. You owe back taxes and a warrant will be issued")).toEqual({ type: "impersonation", confident: true });
    expect(s("Chase Fraud Alert: did you attempt a purchase of $849? Reply YES or NO")).toEqual({ type: "impersonation", confident: true });
    expect(s("Your electric company says power will be shut off in one hour")).toEqual({ type: "impersonation", confident: true });
    expect(s("Grandma it's me, I need money for bail, don't tell mom")).toEqual({ type: "family_emergency", confident: true });
    expect(s("Congratulations, you've won a $1,000 prize!")).toEqual({ type: "too_good", confident: true });
    expect(s("Remote job offer: work from home, $500 a day")).toEqual({ type: "too_good", confident: true });
    expect(s("A popup said my computer has a virus and to call Microsoft")).toEqual({ type: "tech_support", confident: true });
    expect(s("Two men knocked on my door offering to pave the driveway")).toEqual({ type: "in_person", confident: true });
  });

  it("treats family + arrest as a family emergency, not impersonation", () => {
    expect(s("Officer here, your grandson was arrested and needs bail").type).toBe("family_emergency");
  });

  it("recognizes government bid and procurement messages as impersonation", () => {
    expect(s(RFP_BID_REPORT)).toEqual({ type: "impersonation", confident: true });
    expect(s("Procurement notice from a government agency")).toEqual({ type: "impersonation", confident: true });
    expect(s("County RFP: submit your bid today")).toEqual({ type: "impersonation", confident: true });
    expect(s("Bid invitation, details at nyc-bids.gov")).toEqual({ type: "impersonation", confident: true });
    expect(s("City of Yonkers procurement office: bid closes Friday")).toEqual({ type: "impersonation", confident: true });
    for (const text of [
      "A state agency invited us to submit a bid",
      "The state department of transportation RFP is open",
      "Department of Transportation bid invitation",
      "The police department procurement office needs your bid",
      "state government procurement notice",
    ]) {
      expect(s(text).type, text).toBe("impersonation");
    }
    expect(s("Their roofing quote was state of the art")).toEqual({ type: "in_person", confident: true });
  });

  it("doesn't treat bid or agency words alone as government impersonation", () => {
    for (const text of [
      "I lost an auction bid on a lamp and they texted me to pay anyway",
      "Someone outbid me on eBay, then offered to sell it to me directly. Bid fell through.",
      "A staffing agency called about a job I never applied for",
      "A travel agency said I won a free cruise",
      "An insurance agency kept calling about my car warranty",
      "State Farm insurance agency called about my policy renewal",
      "The billing department said my bid on the item was accepted",
    ]) {
      expect(s(text).type, text).not.toBe("impersonation");
    }
  });

  it("recognizes offers of money as too good to be true", () => {
    for (const text of [
      "Hi [name], we’re touching base about the 90k available for you. Please call [phone] to go over next steps.",
      "Good news: funds available for you today, call to claim",
      "You've been approved for a $25,000 loan",
      "You're pre-approved for $5,000 in cash",
      "Loan available now, $10,000 with no credit check",
    ]) {
      expect(s(text), text).toEqual({ type: "too_good", confident: true });
    }
  });

  it("doesn't treat ordinary mentions of money or availability as an offer", () => {
    for (const text of [
      "Your bill of $90 is due",
      "We're available to help",
      "We're available to you any time this week",
      "Your $500 payment was received",
      "The cash register is available at the front",
    ]) {
      expect(s(text), text).toEqual({ type: "other", confident: false });
    }
  });

  it("defaults to other when nothing matches", () => {
    expect(s("Someone called and hung up right away")).toEqual({ type: "other", confident: false });
    expect(s("")).toEqual({ type: "other", confident: false });
  });

  it("isn't confident when groups compete evenly", () => {
    // One bank match, one prize match: unclear.
    expect(s("Your bank says you won something")).toEqual({ type: "other", confident: false });
  });
});
