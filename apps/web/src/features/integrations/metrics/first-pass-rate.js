/**
 * First-pass rate — % of merged MRs that went through review cleanly.
 *
 * Definition (proxy):
 *   A merged MR is a "clean first pass" when its `user_notes_count`
 *   is ≤ 1 — i.e. at most one reviewer comment before the merge. This
 *   is the same field `avgReviewerComments` uses, so the two metrics
 *   share their underlying signal and stay consistent.
 *
 * Why this proxy
 * ──────────────
 * A strict "rounds" count would require per-MR /discussions API
 * fetches (which we don't do yet — see metrics/rounds.js). For the
 * "clean pass through review" framing, `user_notes_count` is the
 * cheapest reasonable approximation:
 *
 *   0 notes  → either silently approved or merged without review.
 *              We count it as clean. On small teams this is the
 *              common case for trivial PRs and excluding it would
 *              under-count the success rate.
 *   1 note   → one reviewer comment (LGTM, one nit, etc.).
 *              Still a "clean pass" — no back-and-forth.
 *   ≥ 2 notes → at least one reviewer comment followed by something
 *              (author reply, second comment, etc.). Not clean.
 *
 * Returns the same `{ pct, clean, pingPong }` triple shape as
 * `linkagePct` so the widget renderer can stay symmetric with the
 * existing LinkageWidget.
 *
 * Returns null when there are no merged MRs (avoids a misleading "0%"
 * on empty windows — the widget shows a "—" headline instead).
 */
export function firstPassRatePct(mrs = []) {
  const merged = mrs.filter((m) => m.merged_at);
  if (merged.length === 0) return null;
  const clean = merged.filter((m) => {
    const notes = Number(m.user_notes_count);
    if (!Number.isFinite(notes)) {
      // Defensive: if the integration didn't fill in the field,
      // treat it as 0 (no comments → clean) rather than dropping
      // the MR entirely. Older normalised shapes occasionally
      // produced undefined here.
      return true;
    }
    return notes <= 1;
  }).length;
  return {
    pct: Math.round((clean / merged.length) * 100),
    clean,
    pingPong: merged.length - clean,
  };
}
