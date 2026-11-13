import type { ScamType } from "./scam-types";

// Suggests a scam group from the message text. Only "confident" when exactly
// one group matches (or one clearly outscores the rest); otherwise the form
// defaults to "Something else or not sure". Runs in the browser as people type.

type Pattern = Pick<RegExp, "test">;

// The place must be capitalized so "state of the art" or "state of mind" don't match.
const STATE_OR_CITY_OF = /\b[Ss]tate of [A-Z]|\b[Cc]ity of [A-Z]/;
// "state" and "department" alone are too common ("State Farm", "billing
// department"), so they only count in government phrases.
const GOV_SIGNALS: RegExp[] = [
  STATE_OR_CITY_OF,
  /\b[Dd]epartment of (?:the )?[A-Z]/,
  /\bstate (?:agency|department|government)\b/i,
  /\b(?:state|county|city|police) department\b/i,
  /\b(?:government|federal|county)\b|\.gov\b/i,
];
// Common outside government ("eBay bid", "travel agency"), so they need a government signal too.
const BID_WORDS = /\b(?:rfp|bids?|bidding|procurement|agency)\b/i;
const governmentBid: Pattern = {
  test: (text) => BID_WORDS.test(text) && GOV_SIGNALS.some((p) => p.test(text)),
};

// Money and "available"/"approved" are each common alone ("your bill of $90",
// "we're available to help"), so an offer of money needs both.
const MONEY = /\$\s?\d|\b\d[\d,.]*\s?(?:k|thousand|million|grand|dollars?)\b|\b(?:funds?|money|cash|loans?|grants?|payouts?)\b/i;
const OFFER = /\bavailable (?:for|to) you\b|\b(?:you(?:['’]ve| have)? been|you['’]?re|you are) (?:pre-?)?approved\b|\bpre-?approved\b|\bapproved for\b|\b(?:funds?|money|cash|loans?|grants?) (?:is |are )?(?:now )?available\b/i;
const moneyOffer: Pattern = {
  test: (text) => MONEY.test(text) && OFFER.test(text),
};

const RULES: Record<Exclude<ScamType, "other">, Pattern[]> = {
  fake_fee: [
    /\b(usps|ups|fedex|dhl|post office|postal service)\b/i,
    /\b(package|parcel|shipment|delivery|redeliver\w*)\b/i,
    /\b(unpaid toll|toll (balance|fee|bill|violation)|e-?z ?pass|sunpass|fastrak|toll road)\b/i,
    /\bparking (ticket|fine|violation|citation)\b/i,
    /\b(customs|redelivery|shipping) fee\b/i,
  ],
  impersonation: [
    /\b(irs|internal revenue|social security|ssa|medicare|dmv|sheriff|police|officer|warrant|federal agent|fbi)\b/i,
    /\b(bank|chase|wells fargo|bank of america|citi|credit union)\b/i,
    /\bfraud (alert|department)\b/i,
    /\b(electric|gas|water|power|utility) (company|bill|shut ?off|disconnect\w*)\b/i,
    /\b(con ?ed|con edison|pseg|national grid)\b/i,
    /\b(account (has been|is) (suspended|locked|frozen))\b/i,
    STATE_OR_CITY_OF,
    /\bgovernment\b/i,
    governmentBid,
  ],
  family_emergency: [
    /\b(grand(son|daughter|ma|mother|pa|father|child|kid)s?)\b/i,
    /\bbail\b/i,
    /\b(car )?accident\b.*\b(jail|hospital|lawyer|money)\b/i,
    /\b(it'?s me|don'?t tell (mom|dad|anyone))\b/i,
    /\b(son|daughter|nephew|niece) (is|was) (in jail|arrested|in the hospital|in trouble)\b/i,
  ],
  too_good: [
    /\b(you('ve| have)? won|winner|prize|lottery|sweepstakes|jackpot)\b/i,
    /\b(job offer|hiring|work from home|remote position|mystery shopper|recruiter)\b/i,
    /\b(crypto\w*|bitcoin|investment|invest\b|guaranteed (returns?|profit)|trading platform)\b/i,
    moneyOffer,
  ],
  tech_support: [
    /\b(microsoft|windows|apple support|geek squad|norton|mcafee)\b/i,
    /\b(virus|malware|hacked|infected|pop-?up|tech support|technical support)\b/i,
    /\b(remote access|anydesk|teamviewer|computer is locked)\b/i,
  ],
  in_person: [
    /\b(knocked|came to (my|the) (door|house)|door-to-door|at my door|showed up)\b/i,
    /\b(driveway|roof(ing|er)?|paving|asphalt|gutter|contractor|tree (service|trimming))\b/i,
    /\b(in person|walked up|truck)\b/i,
  ],
};

// When a message mentions jail/arrest *and* family words, it's a family emergency, not impersonation.
const OVERRIDES: { when: Exclude<ScamType, "other">; over: Exclude<ScamType, "other"> }[] = [
  { when: "family_emergency", over: "impersonation" },
];

export type Suggestion = { type: ScamType; confident: boolean };

export function suggestScamType(text: string): Suggestion {
  const scores = new Map<Exclude<ScamType, "other">, number>();
  for (const [type, patterns] of Object.entries(RULES) as [Exclude<ScamType, "other">, Pattern[]][]) {
    const score = patterns.filter((p) => p.test(text)).length;
    if (score > 0) scores.set(type, score);
  }
  for (const { when, over } of OVERRIDES) {
    if (scores.has(when) && scores.has(over)) scores.delete(over);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return { type: "other", confident: false };
  if (ranked.length === 1) return { type: ranked[0][0], confident: true };
  const [[top, a], [, b]] = ranked;
  // Several groups match: only confident if the top one clearly leads.
  return a >= 2 && a >= 2 * b ? { type: top, confident: true } : { type: "other", confident: false };
}
