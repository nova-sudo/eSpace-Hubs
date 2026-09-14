"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { PlainSection as Section } from "./plain-section";
import { GoalWidgetsGrid, useGoalWidgetItems } from "@/features/goal-widgets";
import { useAnalyst, ANALYST_MODES } from "@/features/analyst";
import { removeSpec } from "@/features/goal-specs";
import { Badge, Button, Label, Loading } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * GOALS TAB · SECTION 02 — Goal tracking (AI-classified).
 *
 * Uses the shared `<Section>` wrapper for header chrome (number / title /
 * subtitle) like every other section, then renders the AI-classified
 * widgets grouped by their parent L1.
 *
 * Each L1 gets its own "shelf" with the L1 number, title, optional
 * category + weightage, and the count of widgets in the bucket.
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
      <Label>
        {lastAnalyzedAt > 0
          ? `Last analyzed ${relativeTs(lastAnalyzedAt)}`
          : "No classification yet"}
        {unclassifiedCount > 0 ? ` · ${unclassifiedCount} unclassified` : ""}
      </Label>
      <div className="flex items-center gap-2">
        {hasGoals && hasSpecs ? (
          <Button
            variant="soft"
            size="sm"
            onClick={() => requestOpen(ANALYST_MODES.WIDGETS)}
          >
            Open analyst
          </Button>
        ) : null}
        {hasGoals ? (
          <Button size="sm" onClick={() => requestOpen(ANALYST_MODES.ANALYSIS)}>
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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="group flex w-full cursor-pointer items-baseline justify-between gap-4 pb-2 text-left"
      >
        <div className="flex min-w-0 items-baseline gap-3">
          {/* Disclosure chevron — rotates 90° when open. Sits before the
              L1 number so it reads as a single visual unit. */}
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={cn(
              "shrink-0 self-center text-muted-fg transition-transform duration-200 group-hover:text-fg",
              open ? "rotate-90" : "",
            )}
          />
          <Label>L1 · {numberLabel}</Label>
          <h3
            id={headingId}
            className="m-0 truncate text-[15px] font-bold leading-[1.25] text-fg"
            title={l1.title}
          >
            {l1.title}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {l1.category ? <Badge tone="neutral">{l1.category}</Badge> : null}
          <Label>
            {l1.weightage != null ? `${l1.weightage}% · ` : ""}
            {items.length} widget{items.length === 1 ? "" : "s"}
          </Label>
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
      <div className="flex max-w-[580px] flex-col items-start gap-3 rounded-[var(--radius-xl)] bg-card-alt p-8">
        <div className="text-[15px] font-bold text-fg">{title}</div>
        <p className="text-[13px] leading-[1.5] text-muted-fg">{body}</p>
        {onCta ? (
          <Button size="sm" onClick={onCta}>
            {ctaLabel}
          </Button>
        ) : (
          <a
            href={ctaHref}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-ink px-4 text-[13px] font-bold text-ink-on transition-colors hover:opacity-90"
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
