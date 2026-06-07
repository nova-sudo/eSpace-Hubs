"use client";

import { Section } from "../scroll-shell";
import { AttentionBand } from "../attention-band";
import { TicketsTile, PRsTile } from "../tiles";
import { Loading } from "@/components/ui";
import { useGlanceReady } from "../use-section-ready";

/**
 * SECTION 03 — At a glance & on your plate
 *
 * Layout:
 *   sec-head: "03 · At a glance & on your plate" + mono subtitle
 *   AttentionBand (3-card nudges, 3px accent left border, full-width)
 *   grid: 12-col
 *     [Tickets (kanban) 7×3] [Open PRs + commits 5×3]
 */
export function GlanceSection() {
  const ready = useGlanceReady();
  return (
    <Section
      id="sec-glance"
      number="03"
      title="At a glance & on your plate"
      subtitle="Nudges · tickets · open PRs"
      railLabel="glance"
    >
      {!integrationsReady ? (
        <Loading
          loader="helix"
          size="2xl"
          color="var(--accent)"
          label="Loading your plate…"
        />
      ) : (
        <>
          {/* AttentionBand has its own `px-10 pb-5` padding (it pre-dates the
              section shell). The `-mx-10` wrapper lets the band's inner `px-10`
              align content back to the section's inner padding edge instead of
              doubling it. `pb-5` is harmless because the Section's `gap: 18px`
              dominates. */}
          <div className="-mx-10">
            <AttentionBand />
          </div>
          <div
            className="grid min-h-0 flex-1 grid-cols-12 gap-3.5"
            style={{ gridAutoRows: "minmax(0, 1fr)" }}
          >
            <TicketsTile />
            <PRsTile />
          </div>
        </>
      )}
    </Section>
  );
}
