/**
 * Deterministic review-paragraph generator.
 *
 * Turns the dashboard's headline metrics into 3-5 sentences the user can
 * paste straight into Workday / Lattice / a 1:1 doc. No AI required —
 * makes it instant, offline-friendly, and predictable.
 *
 * Optional AI-polish path lives in the tile that uses this output (the
 * tile calls `/api/v1/ai/chat` with this paragraph as input, asking for
 * a tonal pass). We keep that out of this module so the function stays
 * synchronous and pure.
 *
 * Tone rules (chosen deliberately to match the dashboard's "calm,
 * receipts-first" voice):
 *   - First-person plural ("we shipped 23 PRs"). No: easier to paste
 *     into a self-review without renaming pronouns.
 *
 *   - First-person singular ("I shipped 23 PRs"). YES — this is for the
 *     user's own review, paste-ready into "what did you do this period?"
 *     fields.
 *
 *   - No marketing adjectives ("massive", "incredible"). Numbers do the
 *     talking.
 *
 *   - Reference the windows the user actually picked, not "this quarter"
 *     unless it matches.
 */

/**
 * @param {{
 *   rangeLabel: string,                          // "last 90 days", "this quarter"
 *   metrics: Array<[string, string|number, string?]>, // same shape as evidence
 *   starredCount?: number,                       // optional — N starred items
 *   level?: string,                              // e.g. "L1 → L2"
 * }} input
 * @returns {string} a single paragraph (no trailing newline)
 */
export function generateReviewParagraph({
  rangeLabel,
  metrics,
  starredCount = 0,
  level,
}) {
  const m = metricsByLabel(metrics || []);
  const sentences = [];

  // Sentence 1 — opener with merged count + window. Anchors everything.
  const merged = numericFrom(m["Merged PRs"]);
  if (merged != null) {
    const cohort =
      level && level !== "—" ? `As an ${level} engineer` : "Over this window";
    sentences.push(
      `${cohort}, I merged ${formatCount(merged, "pull request")} ${rangeLabel ? `over ${rangeLabel.toLowerCase()}` : ""}.`.trim(),
    );
  }

  // Sentence 2 — quality signals (turnaround + rounds).
  const turnaround = m["Review turnaround"];
  const rounds = m["Rounds / MR"];
  if (turnaround?.value || rounds?.value) {
    const parts = [];
    if (turnaround?.value) {
      parts.push(`median review turnaround held at ${turnaround.value}`);
    }
    if (rounds?.value != null) {
      parts.push(
        `with ~${rounds.value} reviewer comments per MR on average`,
      );
    }
    if (parts.length) {
      sentences.push(capitalise(parts.join(" — ")) + ".");
    }
  }

  // Sentence 3 — process discipline (linkage).
  const linkage = m["Jira linkage"];
  if (linkage?.value) {
    sentences.push(
      `Jira linkage stayed at ${linkage.value} across merged work, so every change traces back to a tracked ticket.`,
    );
  }

  // Sentence 4 — peer signal (reviews given).
  const reviewsGiven = numericFrom(m["Reviews given"]);
  if (reviewsGiven != null && reviewsGiven > 0) {
    sentences.push(
      `Outside my own work, I left ${formatCount(reviewsGiven, "comment")} on teammates' MRs — review load shared, not just consumed.`,
    );
  }

  // Sentence 5 — receipts cap. Only if the user has starred something.
  if (starredCount > 0) {
    sentences.push(
      `${formatCount(starredCount, "highlight")} captured below as receipts.`,
    );
  }

  return sentences.filter(Boolean).join(" ").trim();
}

/* ───────────────────────── helpers ───────────────────────── */

function metricsByLabel(entries) {
  const out = {};
  for (const [label, value, sub] of entries) {
    out[label] = { value, sub };
  }
  return out;
}

function numericFrom(entry) {
  if (!entry) return null;
  const v = entry.value;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    // Strip non-digits/dots — handles "23", "23 PRs", "23%" etc.
    const m = /-?\d+(?:\.\d+)?/.exec(v);
    if (m) return Number(m[0]);
  }
  return null;
}

function formatCount(n, unit) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function capitalise(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
