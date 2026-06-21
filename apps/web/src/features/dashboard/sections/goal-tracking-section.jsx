"use client";

import { useState } from "react";
import { Section } from "../scroll-shell";
import {
  GoalWidgetsGrid,
  WeeklyCompareCard,
  useGoalWidgetItems,
} from "@/features/goal-widgets";
import { useAnalyst, ANALYST_MODES } from "@/features/analyst";
import { removeSpec } from "@/features/goal-specs";
import { Button, Loading } from "@/components/ui";

/**
 * GOALS TAB · SECTION 02 — Goal tracking (AI-classified).
 *
 * Light-themed scroll-snap section. Uses the shared `<Section>` wrapper
 * for header chrome (number / title / subtitle / divider) like every
 * other section, then renders the AI-classified widgets grouped by
 * their parent L1.
 *
 * Each L1 gets its own "shelf" with a serif-italic L1 number, the L1
 * title, optional category + weightage, and the count of widgets in
 * the bucket. The widgets themselves use the standard light-theme card
 * styling (`variant="dark"` — yes, the variant name lies; "dark" maps
 * to fg/card surfaces, "light" was the inverse-on-accent variant we
 * dropped when this section adopted the shared theme).
 *
 * Empty / no-goals states show a CTA that opens the analyst page in
 * analysis mode so the user can classify in one click.
 */
export function GoalTrackingSection() {
  const { requestOpen } = useAnalyst();
  const {
    groupedItems,
    hasGoals,
    hasSpecs,
    lastAnalyzedAt,
    unclassifiedGoals,
    ready,
  } = useGoalWidgetItems();

  // Annotate each item with an `onRetry` so the per-widget error path can
  // re-classify just that goal — wipes the spec and reopens the analyst.
  const annotatedGroups = groupedItems.map((g) => ({
    ...g,
    items: g.items.map((it) => ({
      ...it,
      onRetry: () => {
        removeSpec(it.goal.id);
        requestOpen(ANALYST_MODES.ANALYSIS);
      },
    })),
  }));

  return (
    <Section
      id="sec-goal-tracking"
      number="02"
      title="Goal tracking"
      subtitle="AI-classified · grouped by L1"
      railLabel="goals-ai"
    >
      {/* Status / action toolbar — sits between the section header and
          the widgets so users always have one-click access to "open
          analyst" and a glance at when things were last classified. */}
      <Toolbar
        lastAnalyzedAt={lastAnalyzedAt}
        unclassifiedCount={unclassifiedGoals.length}
        hasGoals={hasGoals}
        hasSpecs={hasSpecs}
        requestOpen={requestOpen}
      />

      {!ready ? (
        <Loading loader="dna-helix" size="lg" label="Loading goals…" />
      ) : !hasGoals ? (
        <EmptyState
          title="Add goals to start tracking"
          body="You haven't added any L1 or L2 goals yet. Paste them into Settings and the analyst will turn each into a live widget here."
          ctaLabel="Open Settings"
          ctaHref="/settings"
        />
      ) : !hasSpecs ? (
        <EmptyState
          title="Analyze with AI"
          body="Classify each of your goals into an auto- or manually-tracked widget. Takes a moment; each classification streams in live."
          ctaLabel="Analyze my goals"
          onCta={() => requestOpen(ANALYST_MODES.ANALYSIS)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-7">
            {annotatedGroups.map((group, idx) => (
              <L1Group
                key={group.l1.id}
                l1={group.l1}
                items={group.items}
                index={idx + 1}
              />
            ))}
            {/* Compare-weeks table at the bottom — collapsed by default.
                One row per goal × last 12 weekly snapshots, so users can
                see the trajectory that produced each L1 shelf's
                compliance number. */}
            <WeeklyCompareCard groups={annotatedGroups} />
          </div>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────── Toolbar (status + actions) ─────────────────── */

function Toolbar({
  lastAnalyzedAt,
  unclassifiedCount,
  hasGoals,
  hasSpecs,
  requestOpen,
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span
        className="uppercase tracking-[0.5px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {lastAnalyzedAt > 0
          ? `Last analyzed ${relativeTs(lastAnalyzedAt)}`
          : "No classification yet"}
        {unclassifiedCount > 0 ? ` · ${unclassifiedCount} unclassified` : ""}
      </span>
      <div className="flex items-center gap-2">
        {hasGoals && hasSpecs ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => requestOpen(ANALYST_MODES.WIDGETS)}
          >
            Open analyst
          </Button>
        ) : null}
        {hasGoals ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => requestOpen(ANALYST_MODES.ANALYSIS)}
          >
            {hasSpecs ? "Re-analyze" : "Analyze with AI"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────── L1 group "shelf" ─────────────────── */

/**
 * One L1 shelf — collapsed by default so the section reads as a tidy
 * index of "what's being tracked" rather than a wall of widgets.
 *
 * The header is a button: clicking toggles the shelf open / closed.
 * Chevron indicator on the left rotates 90° when open. The grid is
 * conditionally rendered (not just hidden) so collapsed shelves cost
 * nothing in render time or scroll height — important when a user has
 * 4-5 L1s and we don't want the section overflowing the viewport on load.
 */
function L1Group({ l1, items, index }) {
  const numberLabel = String(index).padStart(2, "0");
  const [open, setOpen] = useState(false);
  const headingId = `l1-group-${l1.id}-title`;
  const panelId = `l1-group-${l1.id}-panel`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="group flex w-full cursor-pointer items-baseline justify-between gap-4 border-b border-border pb-2 text-left transition-colors hover:border-border-strong"
      >
        <div className="flex min-w-0 items-baseline gap-3">
          {/* Disclosure chevron — `›` when closed, rotated 90° when open.
              Sits before the L1 number so it reads as a single visual unit. */}
          <span
            aria-hidden="true"
            className="inline-block text-muted-fg transition-transform group-hover:text-fg"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              lineHeight: 1,
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transitionDuration: "200ms",
              transitionTimingFunction: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            }}
          >
            ›
          </span>
          <span
            className="uppercase text-accent"
            style={{
              fontFamily: "var(--font-dot)",
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: "1px",
              lineHeight: 1,
            }}
          >
            L1 · {numberLabel}
          </span>
          <h3
            id={headingId}
            className="m-0 truncate font-bold text-fg"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 15,
              lineHeight: 1.25,
            }}
            title={l1.title}
          >
            {l1.title}
          </h3>
        </div>
        <div
          className="flex shrink-0 items-baseline gap-3 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
        >
          {l1.category ? <span>{l1.category}</span> : null}
          {l1.weightage != null ? <span>{l1.weightage}%</span> : null}
          <span>
            {items.length} widget{items.length === 1 ? "" : "s"}
          </span>
        </div>
      </button>
      {open ? (
        <div id={panelId} role="region" aria-labelledby={headingId}>
          <GoalWidgetsGrid items={items} variant="dark" />
        </div>
      ) : null}
    </section>
  );
}

/* ─────────────────── Empty state ─────────────────── */

function EmptyState({ title, body, ctaLabel, ctaHref, onCta }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="flex max-w-[580px] flex-col items-start gap-4 rounded-[var(--radius-tile)] border border-border bg-card-alt p-8">
        <div
          className="font-semibold text-fg"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            letterSpacing: "-0.6px",
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        <div
          className="text-muted-fg"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {body}
        </div>
        {onCta ? (
          <Button variant="primary" size="sm" onClick={onCta}>
            {ctaLabel}
          </Button>
        ) : (
          <a
            href={ctaHref}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-tile)] border border-accent bg-accent px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.4px] text-accent-on transition-colors hover:opacity-90"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {ctaLabel}
          </a>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── helpers ─────────────────── */

function relativeTs(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
