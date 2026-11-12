import { describe, expect, it } from "vitest";
import { CHANNEL_KEYS, LEGACY_SCAM_TYPES, LINK_TIP, SCAM_TYPES, SCAM_TYPE_KEYS, scamTypeInfo, tipsFor, toScamType } from "./scam-types";

describe("scam types", () => {
  it("offers exactly the 7 groups", () => {
    expect(SCAM_TYPE_KEYS).toEqual(["fake_fee", "impersonation", "family_emergency", "too_good", "tech_support", "in_person", "other"]);
  });

  it("maps every legacy type to a group", () => {
    expect(toScamType("delivery")).toBe("fake_fee");
    expect(toScamType("toll")).toBe("fake_fee");
    expect(toScamType("government")).toBe("impersonation");
    expect(toScamType("bank")).toBe("impersonation");
    expect(toScamType("utility")).toBe("impersonation");
    expect(toScamType("prize")).toBe("too_good");
    expect(toScamType("job")).toBe("too_good");
    expect(toScamType("investment")).toBe("too_good");
    expect(toScamType("home_repair")).toBe("in_person");
    for (const group of Object.values(LEGACY_SCAM_TYPES)) expect(group in SCAM_TYPES).toBe(true);
  });

  it("keeps current groups and falls back to other", () => {
    expect(toScamType("family_emergency")).toBe("family_emergency");
    expect(toScamType("tech_support")).toBe("tech_support");
    expect(toScamType("unknown")).toBe("other");
    expect(scamTypeInfo("bank").label).toBe("Impersonation (government, bank, utility, police)");
  });
});

describe("tipsFor", () => {
  it("leads with the link tip for email and text, with no hang-up advice", () => {
    expect(LINK_TIP).toBe("Don't click links. Go to the official website yourself.");
    for (const channel of ["email", "text"] as const) {
      for (const type of SCAM_TYPE_KEYS) {
        const tips = tipsFor(type, channel);
        expect(tips[0], `${type}/${channel}`).toBe(LINK_TIP);
        expect(tips.slice(1).some((t) => /click/i.test(t)), `${type}/${channel}`).toBe(false);
        expect(tips.some((t) => /hang up/i.test(t)), `${type}/${channel}`).toBe(false);
      }
    }
  });

  it("keeps hang up and call back for phone calls", () => {
    expect(tipsFor("impersonation", "call")[0]).toBe(
      "Hang up and call back using a number you look up yourself, like the one on your card, bill, or the official website.",
    );
    expect(tipsFor("family_emergency", "call")[0]).toBe("Hang up and call your family member directly on a number you know.");
    expect(tipsFor("bank", "call")).toEqual(SCAM_TYPES.impersonation.tips);
  });

  it("uses the default tips for other channels or when the channel is unknown", () => {
    for (const channel of CHANNEL_KEYS.filter((c) => c !== "email" && c !== "text")) {
      expect(tipsFor("impersonation", channel)).toEqual(SCAM_TYPES.impersonation.tips);
    }
    expect(tipsFor("fake_fee", undefined)).toEqual(SCAM_TYPES.fake_fee.tips);
  });
});
