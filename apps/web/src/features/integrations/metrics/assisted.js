/**
 * Assisted share — what proportion of merged work carried an assistant label.
 *
 * The cheapest evidence source in the product. Coding assistants already
 * label the pull requests they help produce, and those labels ride along on
 * the merged-PR list this app has fetched since day one. So a goal phrased
 * "80% adoption of agentic workflows" — which every other approach treats as
 * unevidenceable, or worse, as something to self-report — is a substring
 * match on data already in hand. No new connector, no new token, no new
 * consent conversation.
 *
 * ── What this measures, and what it does not ─────────────────────────────
 * It measures the share of MERGED pull requests that carry one of the
 * configured labels. It does not measure how much of the code an assistant
 * wrote, whether its suggestions were good, or whether the person understood
 * what they merged. A label is a claim by the tooling that it was involved,
 * and the honest reading is "assistant was in the loop on N of M merges".
 * The widget and the grader both say so rather than implying more.
 *
 * ── Why the labels are configurable ──────────────────────────────────────
 * Different assistants stamp different labels, teams rename them, and a goal
 * may deliberately count only one tool. Hard-coding a single vendor's label
 * would quietly return 0% for a team standardised on another, which reads as
 * "nobody adopted it" rather than "we measured the wrong thing".
 *
 * GitLab is not excluded on purpose — its MRs carry `labels` in the same
 * normalised shape. It simply returns nothing until something labels them.
 */

/**
 * The labels counted when a spec does not name its own.
 *
 * Lower-cased, matched exactly against a normalised MR's `labels`. Kept
 * deliberately short: a broad prefix match would sweep in unrelated labels
 * like "ai-review-requested" and inflate the number.
 */
export const DEFAULT_ASSISTED_LABELS = Object.freeze([
  "claude-code-assisted",
  "copilot-assisted",
  "cursor-assisted",
  "ai-assisted",
]);

function labelSet(labels) {
  const list =
    Array.isArray(labels) && labels.length > 0 ? labels : DEFAULT_ASSISTED_LABELS;
  return new Set(
    list
      .map((l) => (typeof l === "string" ? l.trim().toLowerCase() : null))
      .filter(Boolean),
  );
}

/** True when a normalised MR carries any of the configured labels. */
export function isAssisted(mr, labels) {
  const want = labelSet(labels);
  const have = Array.isArray(mr?.labels) ? mr.labels : [];
  for (const name of have) {
    if (typeof name === "string" && want.has(name.trim().toLowerCase())) return true;
  }
  return false;
}

/**
 * `{ pct, assisted, unassisted, matched }` over merged MRs, or null when the
 * window holds none.
 *
 * Null rather than 0% on an empty window, for the same reason
 * `firstPassRatePct` returns null: "0% of nothing" reads as a failure when it
 * is an absence of data, and the widget renders "—" instead.
 *
 * `matched` lists the labels that actually appeared, so the widget can show
 * WHICH assistant was seen rather than asserting a bare percentage. When it
 * is empty and the count is zero, the honest reading is "no labelled merges
 * found", which may mean no adoption OR a label this goal is not watching —
 * the widget says as much rather than picking one.
 */
export function assistedSharePct(mrs = [], labels) {
  const merged = (Array.isArray(mrs) ? mrs : []).filter((m) => m?.merged_at);
  if (merged.length === 0) return null;

  const want = labelSet(labels);
  const matched = new Set();
  let assisted = 0;

  for (const mr of merged) {
    const have = Array.isArray(mr.labels) ? mr.labels : [];
    let hit = false;
    for (const name of have) {
      const n = typeof name === "string" ? name.trim().toLowerCase() : null;
      if (n && want.has(n)) {
        matched.add(n);
        hit = true;
      }
    }
    if (hit) assisted += 1;
  }

  return {
    pct: Math.round((assisted / merged.length) * 100),
    assisted,
    unassisted: merged.length - assisted,
    total: merged.length,
    matched: [...matched].sort(),
  };
}
