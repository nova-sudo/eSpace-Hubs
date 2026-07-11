/**
 * Best-effort linkage between shipped receipts (PRs / tickets / reviews) and
 * the goals they serve. There is no 1:1 receipt→goal edge in the data, so we
 * stay honest:
 *
 *   - Per-receipt tag: the Jira key the receipt actually references
 *     (MR title / branch / description, or the ticket's own key, or a key in
 *     the reviewed MR's title). Real linkage or nothing — we never invent a
 *     confident-but-wrong goal name. `null` when no key is present.
 *
 *   - Goal coverage: derived from the real per-goal evidence readings
 *     (useGoalReadings), grouped by L1 — how many goals in each area currently
 *     have supporting evidence (a non-"muted" reading) out of the total. This
 *     is genuine "how well-covered is each goal area", not a receipt count
 *     attributed by guesswork.
 *
 * Pure — no React, no IO.
 */

// JIRA_KEY_RE (`[A-Z][A-Z0-9]+-\d+`) structurally matches plenty of non-tickets
// — "AES-256", "SHA-256", "UTF-8", "RFC-2119". So a raw match is NOT enough: we
// only tag a receipt when the extracted key's PROJECT prefix belongs to a real
// Jira project the user actually has tickets in (knownProjectsFrom). No Jira /
// no match → no tag, never a confident-but-wrong one.
import { JIRA_KEY_RE } from "@/lib/regex";

/** Set of real Jira project prefixes from the user's tickets (e.g. {"PAY","ESD"}). */
export function knownProjectsFrom(tickets) {
  const set = new Set();
  for (const i of tickets?.issues || []) {
    const key = typeof i?.key === "string" ? i.key : "";
    const prefix = key.split("-")[0];
    if (prefix) set.add(prefix);
  }
  return set;
}

/**
 * First VALID Jira key across the given text fragments, or null.
 * @param {Set<string>|null} known  real project prefixes; a match whose prefix
 *        isn't in this set is rejected (guards against AES-256 / SHA-256 etc.).
 */
export function jiraKeyFrom(known, ...fragments) {
  if (!known || known.size === 0) return null;
  for (const frag of fragments) {
    if (typeof frag !== "string" || !frag) continue;
    const m = frag.match(JIRA_KEY_RE);
    if (!m) continue;
    const key = m[0];
    if (known.has(key.split("-")[0])) return key;
  }
  return null;
}

/**
 * Per-L1 goal coverage from useGoalReadings() output.
 * @param {Array<{level, goal, reading, parentL1}>} goalReadings
 * @returns {Array<{ id, label, covered, total, pct }>} sorted by total desc.
 */
export function coverageByL1(goalReadings) {
  const byL1 = new Map();
  for (const r of goalReadings || []) {
    // Count trackable L2 goals; L1 rollup rows are headers, not goals.
    if (r?.level && r.level !== "L2") continue;
    const l1 = r?.parentL1;
    if (!l1?.id) continue;
    const entry =
      byL1.get(l1.id) || { id: l1.id, label: l1.title || "Untitled", covered: 0, total: 0 };
    entry.total += 1;
    // "muted" tone = awaiting data / no evidence; anything else = covered.
    if (r?.reading?.statusTone && r.reading.statusTone !== "muted") entry.covered += 1;
    byL1.set(l1.id, entry);
  }
  return [...byL1.values()]
    .map((e) => ({ ...e, pct: e.total > 0 ? Math.round((e.covered / e.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}
