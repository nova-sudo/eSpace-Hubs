"use client";

/**
 * One flow-map row: a collapsed summary (kind label, title, tier/status
 * badge, mini cadence stepper, headline value + chevron) that expands in
 * place to the goal's full detail.
 *
 * The expanded body is NOT reimplemented here — it mounts the same
 * `<GoalWidget>` + `<GoalTierLadder>` the rest of the app already uses for
 * a classified goal. `GoalWidget` already walks the full readiness state
 * tree (untrackable / pending-approval / delegated / needs-context / ready)
 * and, for a ready MANUAL-variant widget, already mounts `<CadenceStepper>`
 * (all three cadence modes, nested cadences, the window panel, the
 * per-cadence tier ladder) plus the full action footer (why / edit setup /
 * edit truths / delegate / build my own / re-analyze). `GoalTierLadder`
 * renders the Final (whole-goal) ladder, all five verdict states, the
 * consistency-cap note, and the three governance/lock treatments.
 *
 * Reusing these means Phases 3–6 of the flow-map design are near-zero new
 * UI code — the flow map differs from the current Goals page only in HOW
 * these are laid out (a row that expands in place vs. a grid tile), not in
 * what they show.
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
// primitive supports, so the collapsed row's mini stepper is built locally
// with the SAME cell size/state colors as FillStrip's `row` size, plus that
// one extra decoration.
const ROW_CELL_BG = {
  filled: "var(--ink)",
  owed: "var(--peach-ink)",
  current: "var(--card-alt)",
  future: "var(--card-alt)",
  settled: "var(--card-alt)",
};
const ROW_CELL_OPACITY = { owed: 0.55, settled: 0.6 };

/** Compact per-window stepper for the collapsed row, capped to the last 12
 *  windows so it fits a row, with a 2px tier-colored underline on any
 *  window that's already been graded (see `windowTier`) — visible without
 *  opening the row. */
function MiniStepper({ goalId, cyc }) {
  if (!cyc) return null;
  const windows = (cyc.windows || []).slice(-12);
  return (
    <div className="flex shrink-0 items-center gap-[3px]" title={`${cyc.filledCount}/${cyc.total} filled`}>
      {windows.map((w) => {
        const color = tierColor(windowTier(goalId, w.key));
        return (
          <span
            key={w.key}
            title={`${w.label} · ${w.state}`}
            className="h-4 w-2 shrink-0 rounded-[3px]"
            style={{
              background: ROW_CELL_BG[w.state] || ROW_CELL_BG.future,
              opacity: ROW_CELL_OPACITY[w.state] ?? 1,
              border: w.state === "current" ? "1.5px dashed var(--dim-fg)" : undefined,
              borderBottom: color ? `2px solid ${color}` : undefined,
              boxSizing: "border-box",
            }}
          />
        );
      })}
    </div>
  );
}

export function FlowRow({ item, style, open, onToggle, level = 2, focused, rowRef }) {
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

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-expanded={open}
      aria-label={`${kindLabel} — ${spec?.title || goal.title || "untitled"}`}
      tabIndex={-1}
      data-flow-row={goalId}
      className="absolute overflow-hidden rounded-[var(--radius-lg)]"
      style={{
        ...style,
        background: isGhost ? "transparent" : "var(--card)",
        boxShadow: isGhost ? undefined : "var(--shadow-card)",
        border: isGhost ? "1.5px dashed var(--dim-fg)" : undefined,
        boxSizing: "border-box",
      }}
    >
      <div
        ref={rowRef}
        role="button"
        tabIndex={focused ? 0 : -1}
        onClick={() => onToggle(goalId)}
        onKeyDown={handleKeyDown}
        aria-pressed={open}
        className="grid w-full cursor-pointer items-center gap-3.5 px-5 py-4 text-left"
        style={{ gridTemplateColumns: "84px minmax(0,1fr) auto auto auto auto" }}
      >
        <Label className="truncate">{kindLabel}</Label>

        <div
          className={cn("truncate", isGhost ? "text-[14.5px] font-semibold text-muted-fg" : "text-[14.5px] font-bold text-fg")}
        >
          {spec?.title || goal.title || "(untitled)"}
        </div>

        {isGhost ? (
          <span />
        ) : readiness !== "ready" ? (
          <Badge tone={readiness === "needs-context" || readiness === "pending-approval" ? "lemon" : "neutral"}>
            {readinessLabel(readiness) || "Not ready"}
          </Badge>
        ) : hasTiers ? (
          <GoalTierBadge goalId={goalId} spec={spec} />
        ) : (
          <span />
        )}

        {cyc ? <MiniStepper goalId={goalId} cyc={cyc} /> : <span />}

        {headline ? (
          <span className="text-right text-[14px] font-extrabold tabular-nums text-fg">{headline.value}</span>
        ) : (
          <span />
        )}

        {isGhost ? (
          <Button variant="tint" tone="lav" size="sm" onClick={openAnalyst}>
            <Sparkles size={13} />
            Classify with AI
          </Button>
        ) : open ? (
          <ChevronUp size={16} className="shrink-0 text-muted-fg" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-muted-fg" />
        )}
      </div>

      {open ? (
        <div className="border-t border-line px-5 py-4">
          {isGhost ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-[13px] leading-[1.5] text-muted-fg">
                The analyst hasn&apos;t classified this goal yet — it has no widget, no
                cadence, and nothing to grade until it is.
              </p>
              <Button variant="tint" tone="lav" size="sm" className="w-fit" onClick={openAnalyst}>
                <Sparkles size={13} />
                Classify with AI
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <GoalWidget spec={spec} goal={goal} variant="dark" />
              <GoalTierLadder spec={spec} variant="dark" />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function humanizeKind(widget) {
  const meta = SPEC_KIND_META?.[widget]?.label;
  if (meta) return meta;
  return String(widget || "")
    .toLowerCase()
    .replace(/_/g, " ");
}
