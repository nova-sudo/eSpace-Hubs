"use client";

/**
 * One flow-map row: a collapsed summary (kind label, title, tier chip,
 * readiness pill) that expands in place to the goal's full detail.
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

import { GoalTierBadge, GoalTierLadder, useGoalTier } from "@/features/goal-tiers";
import { GoalWidget, goalReadiness, readinessLabel } from "@/features/goal-widgets";
import { SPEC_KIND_META } from "@/features/goal-specs";
import { useIsContextComplete } from "@/features/goal-context";
import { useAnalystOptional, ANALYST_MODES } from "@/features/analyst";

const READY_DOT = {
  ready: "var(--accent-2)",
  "needs-context": "var(--warn)",
  "pending-approval": "var(--warn)",
  delegated: "var(--muted-fg)",
  untrackable: "var(--muted-fg)",
  unclassified: "var(--dim-fg)",
};

export function FlowRow({ item, style, open, onToggle, level = 2, focused, rowRef }) {
  const { goal, spec } = item;
  const goalId = goal.id;
  const isGhost = !spec;
  const contextComplete = useIsContextComplete(spec);
  const readiness = goalReadiness(spec, contextComplete);
  const { hasTiers } = useGoalTier(goalId, spec);
  const analyst = useAnalystOptional();
  const kindLabel = spec?.widget ? humanizeKind(spec.widget) : "unclassified";

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle(goalId);
    }
  }

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-expanded={open}
      aria-label={`${kindLabel} — ${spec?.title || goal.title || "untitled"}`}
      tabIndex={-1}
      data-flow-row={goalId}
      className="absolute rounded-[var(--radius-tile)] bg-card"
      style={{
        ...style,
        border: isGhost
          ? "1px dashed var(--border-strong)"
          : `1px solid ${open ? "var(--border-strong)" : "var(--border)"}`,
        background: isGhost ? "transparent" : "var(--card)",
      }}
    >
      <div
        ref={rowRef}
        role="button"
        tabIndex={focused ? 0 : -1}
        onClick={() => onToggle(goalId)}
        onKeyDown={handleKeyDown}
        aria-pressed={open}
        className="flex w-full cursor-pointer items-center gap-3.5 px-3.5 py-2.5 text-left"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: READY_DOT[readiness] || "var(--dim-fg)" }}
          title={readinessLabel(readiness) || "ready"}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span
              className="truncate text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, textTransform: "uppercase", letterSpacing: "0.6px" }}
            >
              {isGhost ? "unclassified · no widget" : kindLabel}
            </span>
            {hasTiers ? <GoalTierBadge goalId={goalId} spec={spec} /> : null}
          </div>
          <div
            className="truncate text-[12.5px] font-semibold"
            style={{ lineHeight: 1.3, color: isGhost ? "var(--muted-fg)" : "inherit" }}
          >
            {spec?.title || goal.title || "(untitled)"}
          </div>
        </div>
        <span
          className="shrink-0 text-dim-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {open ? "▾" : "▸"}
        </span>
      </div>

      {open ? (
        <div className="border-t border-border px-3.5 py-3">
          {isGhost ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-[12px] leading-[1.5] text-muted-fg">
                The analyst hasn&apos;t classified this goal yet — it has no widget, no
                cadence, and nothing to grade until it is.
              </p>
              <button
                type="button"
                onClick={() => analyst?.requestOpen?.(ANALYST_MODES.ANALYSIS)}
                className="w-fit rounded-[var(--radius-sub)] border border-accent bg-accent px-3 py-1.5 text-accent-on"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", cursor: "pointer" }}
              >
                Classify with AI
              </button>
            </div>
          ) : (
            <>
              <GoalWidget spec={spec} goal={goal} variant="dark" />
              <GoalTierLadder spec={spec} variant="dark" />
            </>
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
