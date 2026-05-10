"use client";

import { Section } from "../scroll-shell";
import { ReviewTimingTile } from "../tiles";

/**
 * SECTION 02 — Review timing
 *
 * Surfaces three numbers the engineer cares about most when arguing for
 * smoother review SLAs:
 *
 *   TTFR        Push → first review.
 *   ATTNR       Average between subsequent review rounds.
 *   Total idle  Sum of TTFR + every TTNthR — the "ball was in the
 *               reviewer's court" wait time across all PRs in the window.
 *
 * The illustrative timeline (Push ━━ TTFR ━━ Comment ━━ ATTNR ━━ Comment)
 * lets the user SEE which segment dominates. The most-idle PRs sit
 * underneath and link into /reviews where each PR's full thread + code
 * snippets are visible.
 *
 * Single full-width tile spans the section — at this density (3 big stats
 * + timeline + ranked list) it earns the real estate, and the section's
 * scroll-snap makes it feel like a focused analytical view.
 */
export function ReviewTimingSection() {
  return (
    <Section
      id="sec-review-timing"
      number="02"
      title="Review timing"
      subtitle="TTFR · ATTNR · idle"
      railLabel="reviews"
    >
      <div
        className="grid min-h-0 flex-1 grid-cols-12 gap-3.5"
        style={{ gridAutoRows: "minmax(0, 1fr)" }}
      >
        <ReviewTimingTile />
      </div>
    </Section>
  );
}
