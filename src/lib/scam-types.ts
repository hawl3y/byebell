// Must match the enums in supabase/migrations/*_create_reports.sql.

export const CHANNELS = {
  text: "Text message",
  call: "Phone call",
  email: "Email",
  website: "Website or ad",
  visit: "In person",
  other: "Other",
} as const;

export type Channel = keyof typeof CHANNELS;

/** `messageTips` replaces `tips` for email and text, after LINK_TIP. */
type ScamTypeInfo = { label: string; tips: readonly string[]; messageTips?: readonly string[] };

export const LINK_TIP = "Don't click links. Go to the official website yourself.";

// The 7 groups people choose from (and the app writes).
export const SCAM_TYPES = {
  fake_fee: {
    label: "Fake fee or delivery (package, unpaid toll, parking)",
    tips: [
      "Don't click the link. Check tracking or your account on the carrier's or agency's own website or app.",
      "Carriers and toll agencies don't ask for payment by text, or threaten instant penalties.",
    ],
    messageTips: ["Carriers and toll agencies don't ask for payment by text, or threaten instant penalties."],
  },
  impersonation: {
    label: "Impersonation (government, bank, utility, police)",
    tips: [
      "Hang up and call back using a number you look up yourself, like the one on your card, bill, or the official website.",
      "Real agencies, banks, and utilities don't demand immediate payment or ask for your PIN or a code sent to your phone.",
      "Never pay with gift cards, wire transfers, payment apps, or cryptocurrency.",
    ],
    messageTips: [
      "Real agencies, banks, and utilities don't demand immediate payment or ask for your PIN or a code sent to your phone.",
      "Never pay with gift cards, wire transfers, payment apps, or cryptocurrency.",
    ],
  },
  family_emergency: {
    label: "Family emergency (grandparent, loved one in trouble)",
    tips: [
      "Hang up and call your family member directly on a number you know.",
      "Ask a question only the real person would know.",
      "Scammers push for secrecy and speed. Take your time and tell someone.",
    ],
    messageTips: [
      "Call your family member directly on a number you know.",
      "Ask a question only the real person would know.",
      "Scammers push for secrecy and speed. Take your time and tell someone.",
    ],
  },
  too_good: {
    label: "Too good to be true (prize, job offer, investment or crypto)",
    tips: [
      "You can't win a contest you didn't enter, and real prizes never require a fee.",
      "Real employers don't ask you to pay to start or to send back money from a check they mailed you.",
      "Guaranteed high returns are a warning sign, especially from people you met online.",
    ],
  },
  tech_support: {
    label: "Tech support or computer virus",
    tips: [
      "Real companies don't call you about viruses or show pop-ups with phone numbers.",
      "Never let a caller control your computer remotely.",
      "If you let someone in, disconnect from the internet and get local help.",
    ],
  },
  in_person: {
    label: "Home repair or in-person",
    tips: [
      "Be wary of door-to-door offers for repairs you didn't request.",
      "Ask for ID and call the company back on a number you look up yourself.",
      "Get written estimates, check licenses, and never pay the full amount up front.",
    ],
  },
  other: {
    label: "Something else or not sure",
    tips: [
      "Don't click links or call numbers in unexpected messages.",
      "Never pay with gift cards, wire transfers, or cryptocurrency.",
      "When in doubt, talk to someone you trust before acting.",
    ],
    messageTips: [
      "Never pay with gift cards, wire transfers, or cryptocurrency.",
      "When in doubt, talk to someone you trust before acting.",
    ],
  },
} as const satisfies Record<string, ScamTypeInfo>;

export type ScamType = keyof typeof SCAM_TYPES;

// Earlier, finer-grained types still stored on older reports and clusters.
// The database keeps these enum values; the app shows them as their group.
export const LEGACY_SCAM_TYPES = {
  government: "impersonation",
  bank: "impersonation",
  utility: "impersonation",
  delivery: "fake_fee",
  toll: "fake_fee",
  prize: "too_good",
  job: "too_good",
  investment: "too_good",
  home_repair: "in_person",
} as const satisfies Record<string, ScamType>;

/** Any type value from the database, including legacy ones. */
export type StoredScamType = ScamType | keyof typeof LEGACY_SCAM_TYPES;

export function toScamType(value: string): ScamType {
  if (value in SCAM_TYPES) return value as ScamType;
  return (LEGACY_SCAM_TYPES as Record<string, ScamType>)[value] ?? "other";
}

export function scamTypeInfo(value: string): ScamTypeInfo {
  return SCAM_TYPES[toScamType(value)];
}

/** Tips for how the scam arrived: email and text lead with LINK_TIP; calls and others get the default list. */
export function tipsFor(type: string, channel: Channel | null | undefined): readonly string[] {
  const info = scamTypeInfo(type);
  if (channel === "email" || channel === "text") return [LINK_TIP, ...(info.messageTips ?? info.tips)];
  return info.tips;
}

export const CHANNEL_KEYS = Object.keys(CHANNELS) as [Channel, ...Channel[]];
export const SCAM_TYPE_KEYS = Object.keys(SCAM_TYPES) as [ScamType, ...ScamType[]];

/** Shown by Check when nothing similar was reported nearby. */
export const GENERAL_WARNING_SIGNS = [
  "It's unexpected and urgent: act now, or something bad happens.",
  "It asks for payment by gift card, wire transfer, payment app, or cryptocurrency.",
  "It asks for a password, PIN, Social Security number, or a code sent to your phone.",
  "It has a link or number to call that you didn't look up yourself.",
  "It asks you to keep it secret or not tell your family or bank.",
];
