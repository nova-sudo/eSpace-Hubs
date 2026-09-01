/** Matches `BIDAYA-123`, `PAY-4812`, etc. */
export const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;

/**
 * Common ALLCAPS-dash-number tokens that are NOT Jira keys but match
 * JIRA_KEY_RE's shape (audit #237: "supports UTF-8 output" or "bump to
 * SHA-256" counted a PR as Jira-linked). A focused denylist beats
 * tightening the shape — real project keys are as free-form as these.
 * Kept short and famous on purpose: a project actually named "UTF"
 * loses linkage credit, which is the safer failure than inflating
 * everyone's linkage % with encodings and hash names.
 */
// Only tokens nobody would name a Jira project after. Short two-letter
// entries ("ES", "MD") were dropped: an org's real project key can look
// exactly like that, and zeroing a team's own linkage is the worse bug.
const NON_ISSUE_PREFIXES = new Set([
  "UTF",
  "SHA",
  "CVE",
  "ISO",
  "RFC",
  "AES",
  "RSA",
  "TLS",
  "SSL",
  "HTTP",
]);

/**
 * True when `text` contains something that reads as a REAL Jira issue
 * key — JIRA_KEY_RE's shape minus the famous tech tokens above. Use
 * this (not the raw regex) wherever the answer feeds a metric.
 */
export function hasJiraKey(text) {
  if (typeof text !== "string" || !text) return false;
  const re = /\b([A-Z][A-Z0-9]+)-\d+\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!NON_ISSUE_PREFIXES.has(m[1])) return true;
  }
  return false;
}
