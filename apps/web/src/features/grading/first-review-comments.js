/**
 * Filter a PR's comments down to the FIRST review round.
 *
 * Definition
 * ──────────
 * A "first review round" runs from PR open until the first author
 * response after the first reviewer comment. After the author pushes
 * fixes or replies, round 2 begins.
 *
 * We can't always tell when the author "responded" — author replies
 * via the API look like any other comment, and code pushes don't
 * appear as comments at all. So this filter takes a conservative,
 * easy-to-reason-about cut:
 *
 *   Include every comment up to AND INCLUDING the FIRST reviewer
 *   comment. Comments authored by the PR author (even if posted
 *   before the first review) are kept too — they're the PR's own
 *   description / context, which the AI rubric grader can use.
 *
 * That captures "the state at first review" with no false positives
 * (we never accidentally include round-2 reviewer feedback) at the
 * cost of dropping reviewer comments clustered immediately after the
 * first (e.g. a reviewer who left 3 line-comments in 2 minutes). For
 * MVP this is the right trade-off: under-include rather than mix
 * rounds. A clustering heuristic ("comments within N minutes of the
 * first reviewer comment") could refine this later.
 *
 * @param {Array<{createdAt?: string, user?: string}>} comments
 * @param {string|null|undefined} prAuthor — the PR's author login,
 *   used to distinguish reviewer comments from author replies. When
 *   unknown, we fall back to the first comment of any kind as the
 *   "first review" marker (legacy permissive behaviour).
 * @returns {Array} a NEW array with the same comment shape. Original
 *   ordering preserved. Empty input returns empty output.
 */
export function firstReviewComments(comments, prAuthor) {
  if (!Array.isArray(comments) || comments.length === 0) return [];

  // Sort defensively — the GitHub API usually returns oldest-first
  // but we don't trust the upstream ordering for grading correctness.
  const sorted = [...comments]
    .filter((c) => c && typeof c.createdAt === "string")
    .map((c) => ({ c, ts: Date.parse(c.createdAt) }))
    .filter((e) => Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);

  // Locate the first NON-AUTHOR comment. If we don't know the author,
  // any first comment counts (legacy behaviour matches what
  // computePrReviewTiming does when author is unknown).
  const firstReviewIndex = sorted.findIndex(
    ({ c }) => !prAuthor || (c.user && c.user !== prAuthor),
  );

  if (firstReviewIndex < 0) {
    // No reviewer comment ever — the author may have written a long
    // description but no review happened. Return everything; there's
    // no "round 1" to clip to, and dropping the author description
    // would starve the grader of context.
    return sorted.map(({ c }) => c);
  }

  // Include everything UP TO AND INCLUDING the first reviewer comment.
  return sorted.slice(0, firstReviewIndex + 1).map(({ c }) => c);
}
