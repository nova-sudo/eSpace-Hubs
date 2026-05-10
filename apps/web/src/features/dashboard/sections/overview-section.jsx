"use client";

import { Section } from "../scroll-shell";
import { Hero } from "../hero";
import { DateRangeToolbar } from "../date-range";
import {
  IntegrationsTile,
  MergedTile,
  RoundsTile,
  LinkageTile,
  SinceLastVisitTile,
} from "../tiles";

/**
 * SECTION 01 — Overview
 *
 * Layout:
 *   hero (grid, 2-col: headline + 280x180 signal)
 *   date range toolbar
 *   glance grid: 12-col, 150px auto-rows, 2 rows total
 *     [Integrations 3×2] [Merged 4×2] [Rounds 2×2] [Linkage 3×2]
 *
 * No `.sec-head` per mock — Hero is the top of the page.
 */
export function OverviewSection() {
  return (
    <Section
      id="sec-overview"
      number="01"
      title="Overview"
      railLabel="overview"
      showHead={false}
    >
      <Hero />
      {/* "Since last visit" — quietly omits when the user has nothing new
          to see (first visit / same-session reload). It's a 1-line strip
          so it doesn't disturb the 4-tile glance grid below. */}
      <SinceLastVisitTile />
      {/* DateRangeToolbar pre-dates the section shell and paints its own
          `px-10` paddings. The Section already applies 40px horizontal
          padding, so we cancel the toolbar's `px-10` with a `-mx-10` wrapper
          to keep its internal flex layout (gap, MonoLabel, chips) intact. */}
      <div className="-mx-10">
        <DateRangeToolbar />
      </div>
      {/* Grid fills whatever section height is left after the hero + toolbar.
          All four tiles use `row="span 2"`, so each takes 2fr of the grid's
          2-row budget → equal height tiles. `min-h-0 flex-1` lets the grid
          shrink below its content when the hero is tall (common on wide
          screens where `clamp(..., 6.5vw, 92px)` hits the 92px ceiling). */}
      <div
        className="grid min-h-0 flex-1 grid-cols-12 gap-3.5"
        style={{ gridAutoRows: "minmax(0, 1fr)" }}
      >
        <IntegrationsTile />
        <MergedTile />
        <RoundsTile />
        <LinkageTile />
      </div>
    </Section>
  );
}
