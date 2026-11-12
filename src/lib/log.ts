const MAX_LOG_VALUE = 200;

/**
 * For user-supplied values in logs: control characters (including CR/LF) and
 * Unicode line/paragraph separators are replaced so a value can't forge extra
 * log lines, and length is capped.
 */
export function sanitizeForLog(value: unknown): string {
  const text = String(value ?? "").replace(/[\p{Cc}\u2028\u2029]/gu, " ");
  return text.length > MAX_LOG_VALUE ? `${text.slice(0, MAX_LOG_VALUE)}…` : text;
}
