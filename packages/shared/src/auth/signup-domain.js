/**
 * Free signup domains — email domains whose owners can self-sign-up
 * without an org signup code (the emailed verification link proves
 * ownership). Shared so the web form and the API apply one rule; the
 * API is the authority.
 */

export const DEFAULT_FREE_DOMAINS = ["espace.com.eg"];

/** Parse a comma-separated env value; empty/undefined → the default. */
export function parseFreeDomains(raw) {
  const list = String(raw ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : [...DEFAULT_FREE_DOMAINS];
}

/** Exact, case-insensitive match on the part after the last "@". */
export function isFreeSignupDomain(email, domains) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return false;
  return domains.includes(e.slice(at + 1));
}
