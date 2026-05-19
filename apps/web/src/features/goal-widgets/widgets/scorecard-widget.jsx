"use client";

import { useMemo } from "react";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { useGoalInputs } from "@/features/goal-inputs";
import { useGradedPrs } from "@/features/grading";
import {
  componentScore,
  aggregateScore,
  passingCount,
  extractValue,
} from "./scorecard-aggregate";

/**
 * SCORECARD widget — composite tile that aggregates 2–3 component
 * sub-specs into a single weighted-score headline.
 *
 * Hook-rule discipline
 * ────────────────────
 * The component count is capped at 3 in the validator + JSON Schema.
 * We *always* call exactly 3 component hooks here — unused slots pass
 * a null component, and `useComponentData` short-circuits internally
 * so SWR doesn't fire for the null case. This satisfies React's
 * "same hooks in the same order on every render" rule even when the
 * user adds/removes components in the Review pane (the count change
 * only ever happens between renders, not during one).
 *
 * MANUAL components + storage scope
 * ──────────────────────────────────
 * Each MANUAL component gets a SYNTHETIC sub-goalId so it doesn't
 * collide with sibling components or with any non-SCORECARD goal
 * that happens to share the parent id. Format:
 *   `${parentGoalId}::sc${componentIndex}`
 * The widget body inside a SCORECARD doesn't ship in this MVP — we
 * hand-render compact "ComponentRow" rows that show label + value +
 * target + score. Adding a full "miniature widget body" mode is a
 * future enhancement (see Phase E plan notes).
 *
 * Empty / partial states
 * ──────────────────────
 *   - At least one component has no target → its score is null and
 *     the aggregate excludes it from the denominator. The row still
 *     renders so the user sees "n/a" and can edit a target.
 *   - All components null → aggregate headline is "—".
 *   - Errors on one component → that row shows "!" but other rows
 *     and the aggregate still compute over the ones that worked.
 */
export function ScorecardWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const components = useMemo(
    () => spec?.scorecard?.components || [],
    [spec],
  );
  const aggregate = spec?.scorecard?.aggregate || "weighted";

  // ALWAYS call 3 hooks. Trailing nulls pad the list so the hook
  // count is stable across mounts even when the user removes a
  // component in Review and re-saves.
  const row0 = useComponentData(components[0] || null, goal, 0);
  const row1 = useComponentData(components[1] || null, goal, 1);
  const row2 = useComponentData(components[2] || null, goal, 2);

  // Phase F: per-component CODE_RUBRIC grading. Always invokes 3
  // useGradedPrs calls (mirroring the component-data slots). Each
  // call gates on `enabled` — only the slot that actually carries a
  // CODE_RUBRIC component does any fetching/grading. Each call gets
  // a unique `scopeKey` derived from the parent goal id + slot
  // index so verdicts for different components don't collide in the
  // local cache.
  const rubric0 = useRubricForSlot(components[0], goal, 0);
  const rubric1 = useRubricForSlot(components[1], goal, 1);
  const rubric2 = useRubricForSlot(components[2], goal, 2);
  const rubrics = [rubric0, rubric1, rubric2];

  const rows = [row0, row1, row2]
    .slice(0, components.length)
    .map((row, i) => mergeRubricIntoRow(row, components[i], rubrics[i]));

  const scoredEntries = useMemo(
    () =>
      components.map((c, i) => ({
        weight: Number.isFinite(c.weight) ? c.weight : 0,
        score: componentScore(c, rows[i]?.data),
        loading: rows[i]?.isLoading,
        error: rows[i]?.error,
      })),
    [components, rows],
  );

  const score = aggregateScore(scoredEntries, aggregate);
  const { pass, total } = passingCount(scoredEntries);

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Scorecard · ${components.length} components`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <Headline score={score} pass={pass} total={total} variant={variant} />
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light"
                ? "rgba(255,255,255,0.18)"
                : "var(--border)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${score ?? 0}%`,
              background:
                variant === "light" ? "#ffffff" : "var(--accent)",
            }}
          />
        </div>
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {components.map((c, i) => (
            <ComponentRow
              key={`${c.widget}-${i}`}
              component={c}
              data={rows[i]?.data}
              score={scoredEntries[i]?.score}
              loading={scoredEntries[i]?.loading}
              error={scoredEntries[i]?.error}
              rubric={rows[i]?.rubric}
              variant={variant}
            />
          ))}
        </ul>
      </div>
    </WidgetShell>
  );
}

/**
 * Top-line score + "M/N components on target" subtitle. Renders "—"
 * when there's nothing scoreable so the user doesn't read it as 0%.
 */
function Headline({ score, pass, total, variant }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const monoStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: muted,
    lineHeight: 1.4,
  };
  return (
    <div className="flex items-baseline gap-2">
      <div
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 48,
          letterSpacing: "-1.6px",
        }}
      >
        {score == null ? "—" : `${score}%`}
      </div>
      <div style={monoStyle}>
        {total === 0
          ? "no scoreable components"
          : `${pass}/${total} on target`}
      </div>
    </div>
  );
}

/**
 * One sub-component row inside the scorecard tile.
 *
 * Shows: label (or widget kind fallback), formatted value, target
 * chip, score chip, mini progress bar. Hand-rolled rather than
 * embedding the full widget body to keep the row compact + scannable
 * — a SCORECARD with 3 full widget tiles inside would be unreadable.
 */
function ComponentRow({
  component,
  data,
  score,
  loading,
  error,
  rubric,
  variant,
}) {
  const label =
    component?.label?.trim() ||
    component?.widget?.replace(/_/g, " ").toLowerCase() ||
    "component";
  const target = component?.source?.target || component?.manual?.target;
  const value = extractValue(component, data);
  const isPercent = isPercentMetric(component?.widget);
  const isRubric = component?.widget === "CODE_RUBRIC";

  return (
    <li
      className="flex flex-col gap-1 rounded-[var(--radius-sub)] px-2 py-1.5"
      style={{
        background:
          variant === "light"
            ? "rgba(255,255,255,0.06)"
            : "var(--card-alt)",
      }}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="flex-1 truncate uppercase"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.5px",
            color:
              variant === "light"
                ? "rgba(255,255,255,0.75)"
                : "var(--muted-fg)",
          }}
        >
          {label}
        </span>
        <TargetChip target={target} unit={isPercent ? "%" : ""} variant={variant} />
        <span
          className="rounded-full px-1.5 py-0.5"
          style={{
            fontSize: 9.5,
            letterSpacing: "0.4px",
            background:
              score == null
                ? variant === "light"
                  ? "rgba(255,255,255,0.10)"
                  : "rgba(160,160,160,0.10)"
                : score >= 100
                  ? variant === "light"
                    ? "rgba(120,255,180,0.20)"
                    : "rgba(80,200,120,0.18)"
                  : variant === "light"
                    ? "rgba(255,200,180,0.18)"
                    : "rgba(220,120,80,0.18)",
            color:
              score == null
                ? variant === "light"
                  ? "rgba(255,255,255,0.55)"
                  : "var(--dim-fg)"
                : variant === "light"
                  ? "#ffffff"
                  : "var(--fg)",
          }}
        >
          {score == null ? "n/a" : `${score}%`}
        </span>
      </div>
      <div
        className="flex items-baseline gap-2"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: variant === "light" ? "#ffffff" : "var(--fg)",
        }}
      >
        <span className="font-semibold">
          {error
            ? "!"
            : loading
              ? "…"
              : value == null
                ? "—"
                : formatValue(value, component?.widget)}
        </span>
        <span
          style={{
            fontSize: 9.5,
            color:
              variant === "light"
                ? "rgba(255,255,255,0.55)"
                : "var(--dim-fg)",
          }}
        >
          {weightCopy(component?.weight)}
          {component?.firstReviewOnly ? " · first-review only" : ""}
        </span>
      </div>
      {isRubric ? (
        <RubricRowFooter
          rubric={rubric}
          data={data}
          variant={variant}
        />
      ) : null}
    </li>
  );
}

/**
 * Footer strip for a CODE_RUBRIC component row: shows criteria
 * count, ungraded count, and a "Grade now" button. The button calls
 * the slot's imperative `gradeAll` — the same function the
 * standalone CodeRubricWidget uses. Progress is reported live; on
 * completion the verdicts land in the local store and the parent
 * SCORECARD re-renders with the new pass-rate folded into the
 * aggregate.
 *
 * Rendered conditionally only for CODE_RUBRIC components — the
 * regular ComponentRow stays compact for AUTO/MANUAL components.
 */
function RubricRowFooter({ rubric, data, variant }) {
  if (!rubric) return null;
  const muted =
    variant === "light"
      ? "rgba(255,255,255,0.6)"
      : "var(--dim-fg)";
  const isRunning = rubric.progress?.running === true;
  const criteriaCount = rubric.criteriaCount ?? 0;
  const ungraded = data?.ungraded ?? 0;
  const total = (data?.total ?? 0) + ungraded + (data?.errored ?? 0);
  const canGrade =
    !isRunning &&
    rubric.hasGithub &&
    criteriaCount > 0 &&
    typeof rubric.gradeAll === "function";
  return (
    <div
      className="flex items-center justify-between gap-2"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        color: muted,
        letterSpacing: "0.3px",
      }}
    >
      <span>
        {criteriaCount === 0
          ? "no criteria yet — edit in Review pane"
          : `${criteriaCount} criteri${criteriaCount === 1 ? "on" : "a"} · ` +
            `${data?.pass ?? 0}/${total} graded` +
            (ungraded > 0 ? ` · ${ungraded} ungraded` : "")}
      </span>
      {criteriaCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            if (canGrade) rubric.gradeAll();
          }}
          disabled={!canGrade}
          className="uppercase tracking-[0.5px] transition-opacity disabled:opacity-40"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.5px",
            color: variant === "light" ? "#ffffff" : "var(--fg)",
            background: "transparent",
            border:
              variant === "light"
                ? "1px solid rgba(255,255,255,0.35)"
                : "1px solid var(--border)",
            borderRadius: "var(--radius-sub)",
            padding: "2px 6px",
            cursor: canGrade ? "pointer" : "not-allowed",
          }}
        >
          {isRunning
            ? `Grading… ${rubric.progress?.done ?? 0}/${rubric.progress?.total ?? 0}`
            : "Grade now"}
        </button>
      ) : null}
    </div>
  );
}

function weightCopy(weight) {
  if (!Number.isFinite(weight)) return "";
  return `weight ${Math.round(weight)}`;
}

function isPercentMetric(widget) {
  return (
    widget === "FIRST_PASS_RATE" ||
    widget === "LINKAGE" ||
    widget === "BUILD_PASS_RATE" ||
    widget === "MILESTONE" ||
    widget === "RECURRING_MILESTONE" ||
    widget === "CODE_RUBRIC"
  );
}

/**
 * Phase F: per-slot rubric grading for SCORECARD CODE_RUBRIC
 * components.
 *
 * Always invoked exactly 3 times per render (once per max-component
 * slot) so React's hook count stays stable regardless of how many
 * actual components the user has configured. Slots that aren't
 * CODE_RUBRIC pass `enabled: false` and short-circuit internally
 * — useGradedPrs still runs all its internal hooks but doesn't
 * fetch or grade.
 *
 * Each grading slot gets a unique `scopeKey` derived from the
 * parent goal id + slot index so verdicts for different components
 * (or different SCORECARDs) never collide in the local store.
 */
function useRubricForSlot(component, parentGoal, index) {
  const isRubric = component?.widget === "CODE_RUBRIC";
  const criteria = isRubric ? component?.manual?.items || [] : [];
  const firstReviewOnly = isRubric && component?.firstReviewOnly === true;
  const scopeKey =
    isRubric && parentGoal?.id ? `sc${index}:${parentGoal.id}` : null;
  return useGradedPrs(
    isRubric && parentGoal?.id
      ? { goalId: parentGoal.id, context: { questions: [] } }
      : { goalId: null, context: { questions: [] } },
    {
      enabled: isRubric && criteria.length > 0,
      criteriaOverride: criteria,
      firstReviewOnly,
      scopeKey,
    },
  );
}

/**
 * Fold a rubric slot's `summary` into the component-data row so the
 * downstream extractValue / componentScore path can read `data.pct`
 * uniformly. When the slot isn't a CODE_RUBRIC component, the
 * underlying useGradedPrs ran with `enabled: false` and the rubric
 * summary is empty — we leave the row's data alone in that case.
 *
 * The merge also surfaces `rubric` (criteria), `progress`, and
 * `gradeAll` so the SCORECARD's ComponentRow can offer a "Grade now"
 * affordance specific to this slot.
 */
function mergeRubricIntoRow(row, component, rubric) {
  if (component?.widget !== "CODE_RUBRIC") return row;
  return {
    ...(row || {}),
    data: {
      ...(row?.data || {}),
      pct: rubric.summary?.pct ?? null,
      pass: rubric.summary?.pass ?? 0,
      total: rubric.summary?.total ?? 0,
      ungraded: rubric.summary?.ungraded ?? 0,
      errored: rubric.summary?.errored ?? 0,
    },
    isLoading: rubric.isListLoading,
    error: rubric.listError,
    // Forward the imperative grader + per-slot progress so the
    // ComponentRow can render a "Grade now" button + progress chip.
    rubric: {
      criteriaCount: (rubric.rubric || []).length,
      gradeAll: rubric.gradeAll,
      progress: rubric.progress,
      hasGithub: rubric.hasGithub,
    },
  };
}

/**
 * Lightweight value formatter — small enough to keep inline.
 * Per-widget formatting (e.g. LEAD_TIME's "1h 23m") would need
 * either duplicating those formatters or extracting them; for the
 * MVP we just print the raw number with optional "%" / "m" suffix.
 */
function formatValue(value, widget) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (isPercentMetric(widget)) return `${Math.round(value)}%`;
  if (widget === "LEAD_TIME") return `${Math.round(value)}m`;
  if (widget === "TURNAROUND" || widget === "TICKET_CYCLE") {
    return `${value < 10 ? value.toFixed(1) : Math.round(value)}d`;
  }
  if (widget === "INCIDENT_LOG") return `${Math.round(value)}m`;
  if (Number.isInteger(value)) return String(value);
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

/**
 * Resolve the data payload for one component. Always calls both
 * `useDataSource` (auto) and `useGoalInputs` (manual) so the React
 * hook count stays stable; gates each on the component's variant.
 *
 * MANUAL components write to a synthetic sub-goalId
 * (`${parentGoalId}::sc${index}`) so multiple MANUAL components on
 * one SCORECARD don't share storage. Auto components don't need an
 * id at all — their source describes the upstream feed.
 */
function useComponentData(component, parentGoal, index) {
  const isAuto =
    component?.kind === "auto" || component?.kind === "hybrid";
  const isManual =
    component?.kind === "manual" || component?.kind === "hybrid";

  // Pass null to the data hook when the component is missing or
  // doesn't use a source — useDataSource handles null/undefined
  // gracefully (returns { data: null, isLoading: false }).
  const dataSource = useDataSource(isAuto ? component?.source : null);

  // Synthetic sub-id so MANUAL components have independent storage.
  const subId =
    isManual && parentGoal?.id
      ? `${parentGoal.id}::sc${index}`
      : null;
  const inputs = useGoalInputs(subId);

  if (!component) return null;

  if (isAuto) {
    return {
      data: dataSource.data,
      isLoading: dataSource.isLoading,
      error: dataSource.error,
    };
  }

  // MANUAL: synthesise a data shape from the input entries so
  // `extractValue` can read it uniformly with the AUTO branches.
  const entries = inputs.entries || [];
  return {
    data: synthesizeManualData(component.widget, entries),
    isLoading: false,
    error: null,
  };
}

/**
 * Build a `data` payload for MANUAL widgets from raw entries.
 * Mirrors the field names the existing widgets surface — `total`
 * for COUNTER, `latest` for SCALE, `totalDowntime` + `count` for
 * INCIDENT_LOG, `pct` for MILESTONE / RECURRING_MILESTONE.
 *
 * Anything more nuanced (compliance percentages, streaks) requires
 * the widget's own state machine and isn't worth replicating for
 * MVP. The scorecard treats the raw number as the score input.
 */
function synthesizeManualData(widget, entries) {
  switch (widget) {
    case "COUNTER": {
      let total = 0;
      for (const e of entries) {
        const n = Number(e.value);
        if (Number.isFinite(n)) total += n;
      }
      return { total };
    }
    case "SCALE": {
      const last = entries[entries.length - 1];
      const latest = Number(last?.value);
      return { latest: Number.isFinite(latest) ? latest : null };
    }
    case "INCIDENT_LOG": {
      let totalDowntime = 0;
      for (const e of entries) {
        const d = Number(e.value?.downtime);
        if (Number.isFinite(d)) totalDowntime += d;
      }
      return { totalDowntime, count: entries.length };
    }
    case "MILESTONE":
    case "RECURRING_MILESTONE": {
      const items = entries[entries.length - 1]?.value?.items || [];
      if (items.length === 0) return { pct: null };
      const done = items.filter((it) => it?.done).length;
      return { pct: Math.round((done / items.length) * 100) };
    }
    default:
      return { entries };
  }
}
