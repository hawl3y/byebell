import { linkPattern, trimLink } from "./links";

export { defang } from "./links";

// Rules-based. The reporter reviews and can edit the result before it's posted.

export type RedactionKind = "email" | "phone" | "card" | "account" | "ssn" | "code" | "address" | "name";

export const PLACEHOLDERS: Record<RedactionKind, string> = {
  email: "[email]",
  phone: "[phone]",
  card: "[card number]",
  account: "[account number]",
  ssn: "[SSN]",
  code: "[code]",
  address: "[address]",
  name: "[name]",
};

export type RedactionResult = { text: string; found: Partial<Record<RedactionKind, number>> };

const SENTINEL_OPEN = "\uE000";
const SENTINEL_CLOSE = "\uE001";
// Placeholders already in the text are swapped for one private-use character
// each (no letters or digits) so no rule can match inside or across them. This
// keeps redact(redact(x)) === redact(x), which the post step relies on.
const PLACEHOLDER_BASE = 0xe010;
const KINDS = Object.keys(PLACEHOLDERS) as RedactionKind[];
const PLACEHOLDER_TOKENS = /[-]/g;

/**
 * Browsers submit textarea line breaks as CRLF; normalize so a round trip
 * doesn't look like an edit. Pasted emails also carry runs of blank (often
 * space-only) lines, which are collapsed to one.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/[\uE000-\uE01F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/g;
const PHONE_US = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const PHONE_INTL = /\+\d{1,3}[\s.-]?\d(?:[\s.-]?\d){6,12}\b/g;
const CODE =
  /\b((?:verification|security|confirmation|access|one[- ]time|login|auth(?:entication)?|pass)?\s*(?:code|pin|passcode|password)\s*(?:is|was|of)?\s*[:#]?\s*)(\d{4,8})\b/gi;
const ACCOUNT =
  /\b((?:account|acct|routing|member|policy|card|order|case|reference|ref|invoice|customer|tracking|ssn|social security)\s*(?:number|no\.?|num|#|id)?\s*(?:ending\s+in|ends\s+in|ending|last\s+(?:4|four)(?:\s+digits)?)?\s*(?:is|was|of)?\s*[:#]?\s*)((?:[*xX•]+\s*)?\d[\d -]{2,}\d)\b/gi;
const MASKED = /(?:[*xX•]{2,}[\s-]?)\d{3,4}\b/g;
const LONG_DIGITS = /\b\d{8,}\b/g;

const STREET_SUFFIX =
  "Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Trail|Trl|Square|Sq";
const ADDRESS = new RegExp(
  String.raw`\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:(?:[A-Z][a-zA-Z'.-]*|\d+(?:st|nd|rd|th))\s+){1,4}(?:${STREET_SUFFIX})\b\.?(?:,?\s+(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*[A-Za-z0-9-]+)?`,
  "g",
);
const PO_BOX = /\bP\.?\s?O\.?\s+Box\s+\d+/gi;

// Names: rules can only catch names in common phrasings. The preview step lets
// the reporter fix anything missed.
const NAME_WORD = String.raw`[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?`;
const NAME_1_2 = String.raw`${NAME_WORD}(?:\s+(?:[A-Z]\.\s+)?${NAME_WORD})?`;
const NAME_2 = String.raw`${NAME_WORD}\s+(?:[A-Z]\.\s+)?${NAME_WORD}`;
const ci = (words: string) =>
  words
    .split("|")
    .map((w) => `[${w[0].toUpperCase()}${w[0].toLowerCase()}]${w.slice(1)}`)
    .join("|");

const NAME_RULES: RegExp[] = [
  new RegExp(
    String.raw`(\b(?:${ci("mr|mrs|ms|miss|mx|dr|officer|agent|deputy|sgt|sergeant|detective|lt|lieutenant|captain|capt|judge|attorney|lawyer|pastor|father")})\.?\s+)(${NAME_1_2})`,
    "g",
  ),
  new RegExp(String.raw`(\b(?:${ci("my name is|name's|named|signed|ask for|speak to|speak with|talk to|talk with")})\s+)(${NAME_1_2})`, "g"),
  new RegExp(String.raw`(\b(?:${ci("this is|i'm|i am|it's")})\s+)(${NAME_2})`, "g"),
  new RegExp(
    String.raw`(\b(?:${ci("my|your|our|his|her")})\s+(?:${"son|daughter|grandson|granddaughter|grandchild|nephew|niece|husband|wife|brother|sister|mom|mother|dad|father|grandma|grandmother|grandpa|grandfather|cousin|friend|neighbor|uncle|aunt|boss"})\s*,?\s+)(${NAME_1_2})`,
    "g",
  ),
  new RegExp(String.raw`((?:^|\n)\s*(?:${ci("hi|hello|hey|dear|good morning|good afternoon|good evening")})\s+)(${NAME_1_2})`, "g"),
  // Greeting + name anywhere ("…today. Hi Linda!"), when punctuation follows the name.
  new RegExp(
    String.raw`(\b(?:${ci("hi|hello|hey|dear|good morning|good afternoon|good evening")})\s+)(${NAME_1_2})(?=\s*[,!.:;])`,
    "g",
  ),
  new RegExp(
    String.raw`((?:^|\n)\s*(?:${ci("thanks|thank you|regards|best|sincerely|cheers|respectfully|best regards|kind regards")})\s*,?\s*\n?\s*|\n\s*[-–—]\s*)(${NAME_1_2})(?=\s*$)`,
    "g",
  ),
];

// Words that look like names after a trigger but aren't.
const NOT_NAMES = new Set(
  (
    "there|customer|customers|sir|madam|valued|user|member|friend|all|everyone|team|folks|guys|neighbor|neighbors|" +
    "mom|dad|grandma|grandpa|the|a|an|you|your|my|our|this|that|it|we|they|he|she|calling|here|not|just|also|so|" +
    "very|really|sorry|good|hello|hi|from|with|and|or|at|on|in|of|to|for|urgent|important|final|notice|account|" +
    "amazon|apple|microsoft|google|paypal|venmo|zelle|cash|usps|ups|fedex|dhl|irs|ssa|medicare|walmart|target|netflix|" +
    "chase|wells|fargo|citi|bank|geek|squad|norton|mcafee|costco|best|buy|ebay|facebook|meta|instagram|verizon|" +
    "comcast|xfinity|spectrum|social|security|police|sheriff|department|county|state|federal|support|service|services|" +
    "officer|agent|deputy|detective|sergeant|captain|judge|attorney|mr|mrs|ms|dr"
  ).split("|"),
);

function keepNameWords(candidate: string): string | null {
  const words = candidate.split(/\s+/);
  const kept: string[] = [];
  for (const word of words) {
    if (NOT_NAMES.has(word.toLowerCase().replace(/\.$/, ""))) break;
    kept.push(word);
  }
  return kept.length ? kept.join(" ") : null;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function redact(input: string): RedactionResult {
  const found: RedactionResult["found"] = {};
  const count = (kind: RedactionKind) => {
    found[kind] = (found[kind] ?? 0) + 1;
    return PLACEHOLDERS[kind];
  };

  let text = normalizeText(input);
  for (const [i, kind] of KINDS.entries()) {
    text = text.replaceAll(PLACEHOLDERS[kind], String.fromCharCode(PLACEHOLDER_BASE + i));
  }

  text = text.replace(EMAIL, () => count("email"));

  // Protect links so digits inside them aren't treated as phone/account numbers.
  const links: string[] = [];
  text = text.replace(linkPattern(), (match) => {
    const [link, trailing] = trimLink(match);
    links.push(link);
    return `${SENTINEL_OPEN}${links.length - 1}${SENTINEL_CLOSE}${trailing}`;
  });

  text = text.replace(SSN, () => count("ssn"));
  text = text.replace(CARD, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? count("card") : match;
  });
  text = text.replace(PHONE_INTL, () => count("phone"));
  text = text.replace(PHONE_US, () => count("phone"));
  text = text.replace(CODE, (_m, prefix: string) => prefix + count("code"));
  text = text.replace(ACCOUNT, (_m, prefix: string) => prefix + count("account"));
  text = text.replace(MASKED, () => count("account"));
  text = text.replace(LONG_DIGITS, () => count("account"));
  text = text.replace(ADDRESS, () => count("address"));
  text = text.replace(PO_BOX, () => count("address"));

  for (const rule of NAME_RULES) {
    text = text.replace(rule, (match, prefix: string, candidate: string) => {
      const name = keepNameWords(candidate);
      if (!name) return match;
      return prefix + count("name") + candidate.slice(name.length);
    });
  }

  text = text.replace(
    new RegExp(`${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`, "g"),
    (_m, i: string) => links[Number(i)],
  );
  text = text.replace(PLACEHOLDER_TOKENS, (t) => PLACEHOLDERS[KINDS[t.charCodeAt(0) - PLACEHOLDER_BASE]]);

  return { text, found };
}
