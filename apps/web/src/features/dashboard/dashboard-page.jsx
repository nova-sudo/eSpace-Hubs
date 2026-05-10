import { ScrollShell } from "./scroll-shell";
import {
  OverviewSection,
  ReviewTimingSection,
  GlanceSection,
  TrendSection,
} from "./sections";

/**
 * Performance tab — 4 full-viewport scroll-snap sections.
 *
 * Section order matches the rail order:
 *   01 Overview         → Hero + Signal + glance grid
 *   02 Review timing    → TTFR / ATTNR / idle + most-idle PRs + log link
 *   03 Glance           → Attention band + Tickets kanban + Open PRs
 *   04 Trends           → Activity + Turnaround + Reviews
 *
 * Goals & evidence and Goal tracking (AI) live on the Goals tab now —
 * separating "how am I performing" from "what am I being evaluated on"
 * so each surface stays focused.
 *
 * The `<ScrollShell>` owns the snap container, the right-side section rail,
 * and the bottom-right "XX / 04" counter. Each section registers itself on
 * mount so the rail/counter auto-populate from this file's children.
 */
export function DashboardPage() {
  return (
    <ScrollShell>
      <OverviewSection />
      <ReviewTimingSection />
      <GlanceSection />
      <TrendSection />
    </ScrollShell>
  );
}
