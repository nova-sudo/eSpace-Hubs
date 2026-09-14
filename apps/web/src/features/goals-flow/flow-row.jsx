"use client";

/**
 * One goal in the map. Collapsed it is a two-line card: an identity line
 * (kind, title, tier, status) and a state line (window strip, count,
 * action). Open, it expands in place inside its objective's lane.
 *
 * The expanded body is NOT reimplemented here — it mounts the same
 * `<GoalWidget>` + `<GoalTierLadder>` the rest of the app already uses for a
 * classified goal. `GoalWidget` walks the full readiness state tree and, for
 * a ready MANUAL widget, mounts `<CadenceStepper>` (all cadence modes, the
 * window panel, the per-window tier ladder) plus the action footer.
 * `GoalTierLadder` renders the whole-goal ladder and its lock treatments.
 */

import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { Badge, Button, Label } from "@/components/ui";
import { GoalTierBadge, GoalTierLadder, useGoalTier } from "@/features/goal-tiers";
import { GoalWidget, goalReadiness, readinessLabel } from "@/features/goal-widgets";
import { SPEC_KIND_META } from "@/features/goal-specs";
import { useIsContextComplete } from "@/features/goal-context";
import { useAnalystOptional, ANALYST_MODES } from "@/features/analyst";
import { cn } from "@/lib/cn";
import { cadenceWindowsFor, windowTier, tierColor, goalHeadline } from "./flow-row-meta";

// A per-cell tier-colored underline isn't something the shared FillStrip
// primitive supports, so the strip is built locally with the SAME cell
// states/colors as FillStrip, plus that one extra decoration.
const CELL_BG = {
  filled: "var(--ink)",
  owed: "var(--peach-ink)",
  current: "var(--card-alt)",
  future: "var(--card-alt)",
  settled: "var(--card-alt)",
};
const CELL_OPACITY = { owed: 0.55, settled: 0.6 };

// Capped so a weekly goal's 52 windows don't turn the strip into a hairline
// comb. The count beside it always states the true total.
const MAX_CELLS = 24;

/**
 * The goal's cycle windows as a strip. Sized to the window count rather than
 * stretched across the lane, so a 5-window goal doesn't render five slabs.
 */
function WindowStrip({ goalId, cyc, showLabels }) {
  if (!cyc) return null;
  const windows = (cyc.windows || []).slice(-MAX_CELLS);
  return (
    <div
      className="flex min-w-0 shrink items-end gap-[3px]"
      style={{ width: Math.min(windows.length * 15 + 40, 420) }}
      title={`${cyc.filledCount}/${cyc.total} filled`}
    >
      {windows.map((w) => {
        const color = tierColor(windowTier(goalId, w.key));
        return (
          <span key={w.key} className="flex min-w-0 flex-1 flex-col items-center gap-[3px]">
            <span
              title={`${w.label} · ${w.state}`}
              className="h-3.5 w-full rounded-[4px]"
              style={{
                background: CELL_BG[w.state] || CELL_BG.future,
                opacity: CELL_OPACITY[w.state] ?? 1,
                border: w.state === "current" ? "1.5px dashed var(--dim-fg)" : undefined,
                borderBottom: color ? `2px solid ${color}` : undefined,
                boxSizing: "border-box",
              }}
            />
            {showLabels ? (
              <span className="w-full truncate text-center text-[11px] leading-none text-dim-fg">
                {shortLabel(w.label)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function FlowRow({ item, open, onToggle, level = 2, focused, rowRef, density = "comfortable" }) {
  const { goal, spec } = item;
  const goalId = goal.id;
  const isGhost = !spec;
  const contextComplete = useIsContextComplete(spec);
  const readiness = goalReadiness(spec, contextComplete);
  const { hasTiers } = useGoalTier(goalId, spec);
  const analyst = useAnalystOptional();
  const kindLabel = spec?.widget ? humanizeKind(spec.widget) : "Unclassified";
  const cyc = isGhost ? null : cadenceWindowsFor(goalId, spec);
  const headline = isGhost ? null : goalHeadline(goalId, spec);
  const compact = density === "dense";
  const showLabels = !compact && (cyc?.windows?.length ?? 0) <= MAX_CELLS;

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(goalId);
    }
  }

  function openAnalyst(e) {
    e.stopPropagation();
    analyst?.requestOpen?.(ANALYST_MODES.ANALYSIS);
  }

  // Ghost (unclassified) goals have no widget, cadence or grade — a single
  // dashed line with the one action that changes that.
  if (isGhost) {
    return (
      <div
        role="treeitem"
        aria-level={level}
        aria-expanded={false}
        aria-label={`Unclassified — ${goal.title || "untitled"}`}
        className="flex min-w-0 items-center gap-3 rounded-[var(--radius-lg)] px-4 py-2.5"
        style={{ border: "1.5px dashed var(--dim-fg)", boxSizing: "border-box" }}
      >
        <Label className="shrink-0">Unclassified</Label>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-muted-fg">
          {goal.title || "(untitled)"}
        </span>
        <Button variant="tint" tone="lav" size="sm" onClick={openAnalyst}>
          <Sparkles size={13} />
          Classify
        </Button>
      </div>
    );
  }

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-expanded={open}
      aria-label={`${kindLabel} — ${spec?.title || goal.title || "untitled"}`}
      data-flow-row={goalId}
      className={cn(
        "min-w-0 overflow-hidden rounded-[var(--radius-lg)] bg-card",
        open ? "ring-2 ring-ink" : "",
      )}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div
        ref={rowRef}
        role="button"
        tabIndex={focused ? 0 : -1}
        onClick={() => onToggle(goalId)}
        onKeyDown={handleKeyDown}
        aria-pressed={open}
        className={cn(
          "flex w-full cursor-pointer flex-col gap-2.5 text-left",
          compact ? "px-4 py-2.5" : "px-4 py-3",
        )}
      >
        {/* Identity — what this goal is and how it stands. */}
        <div className="flex min-w-0 items-center gap-2.5">
          <Label className="shrink-0">{kindLabel}</Label>
          <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-fg">
            {spec?.title || goal.title || "(untitled)"}
          </span>
          {readiness !== "ready" ? (
            <Badge tone={readiness === "needs-context" || readiness === "pending-approval" ? "lemon" : "neutral"}>
              {readinessLabel(readiness) || "Not ready"}
            </Badge>
          ) : hasTiers ? (
            <GoalTierBadge goalId={goalId} spec={spec} />
          ) : null}
          {open ? (
            <ChevronUp size={16} className="shrink-0 text-muted-fg" />
          ) : (
            <ChevronDown size={16} className="shrink-0 text-muted-fg" />
          )}
        </div>

        {/* State — the cycle so far, or the headline value for an auto goal. */}
        {!open && (cyc || headline) ? (
          <div className="flex min-w-0 items-end gap-3">
            {cyc ? <WindowStrip goalId={goalId} cyc={cyc} showLabels={showLabels} /> : null}
            {cyc ? (
              <span
                className="shrink-0 text-[12.5px] font-extrabold tabular-nums text-fg"
                style={{ paddingBottom: showLabels ? 16 : 0 }}
              >
                {cyc.filledCount}/{cyc.total}
              </span>
            ) : null}
            {headline && !cyc ? (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="text-[22px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
                  {headline.value}
                </span>
                {headline.status ? (
                  <span className="truncate text-[11.5px] font-semibold" style={{ color: headline.statusColor }}>
                    {headline.status}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-line px-4 py-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <GoalWidget spec={spec} goal={goal} />
            <GoalTierLadder spec={spec} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "Week 37" → "37", "September" → "Sep" — the strip has room for a hint. */
function shortLabel(label) {
  const s = String(label || "");
  const num = s.match(/(\d+)\s*$/);
  if (num) return num[1];
  return s.slice(0, 3);
}

function humanizeKind(widget) {
  const meta = SPEC_KIND_META?.[widget]?.label;
  if (meta) return meta;
  return String(widget || "")
    .toLowerCase()
    .replace(/_/g, " ");
}
