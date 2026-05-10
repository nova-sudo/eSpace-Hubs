import { ScrollShell } from "./scroll-shell";
import {
  GoalsSection,
  GoalTrackingSection,
} from "./sections";

/**
 * Goals tab — 2 full-viewport scroll-snap sections.
 *
 * Section order:
 *   01 Performance goals & evidence  → Goals tree + Snapshots + Export + Commits
 *   02 Goal tracking (AI)            → Inverse theme · AI-classified goal widgets
 *
 * Reuses the same `<ScrollShell>` machinery as the Performance tab so the
 * rail / counter / scroll-snap behaviour is identical. Sections are the
 * exact same components — only the routing changed.
 */
export function GoalsTabPage() {
  return (
    <ScrollShell>
      <GoalsSection />
      <GoalTrackingSection />
    </ScrollShell>
  );
}
