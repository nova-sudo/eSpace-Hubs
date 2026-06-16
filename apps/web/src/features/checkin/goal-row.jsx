"use client";

/**
 * One row of the weekly check-in page — title + kind + an inline editor
 * appropriate to the goal's spec.widget. Pure dispatcher: holds no
 * input state of its own; each editor talks to the goal-inputs store
 * directly via `useGoalInputs`.
 *
 * Auto widgets get a `<AutoReadout>` with the value computed for this
 * week from the integration data the page already loaded (mrs, events,
 * tickets). Manual widgets get their dedicated editor. Phase D/E
 * widgets that need richer editors (incidents, recurring milestone,
 * code rubric, scorecard) get an `<UnsupportedStub>` directing the
 * user to the existing widget UI — until PR #2 of this work-stream
 * builds inline editors for them too.
 */

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { SPEC_KINDS } from "@/features/goal-specs";
import { useIsContextComplete } from "@/features/goal-context";
import { goalReadiness, readinessLabel, GOAL_READINESS } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import {
  avgReviewerComments,
  firstPassRatePct,
  linkagePct,
  medianTurnaroundDays,
} from "@/features/integrations";
import {
  AutoReadout,
  BeforeAfterEditor,
  CounterEditor,
  DateLogEditor,
  FreeTextEditor,
  IncidentLogEditor,
  MilestoneEditor,
  RecurringMilestoneEditor,
  ScaleEditor,
  UnsupportedStub,
} from "@/features/goal-editors";
import { CodeRubricEditor } from "./code-rubric-row";
import {
  buildSubGoal,
  buildSubSpec,
  seedRubricContextIfNeeded,
} from "@/features/goal-widgets/widgets/scorecard-subspec";

/**
 * Widgets whose editor is a chip list / multi-field form that needs the
 * full row width. They render STACKED (editor on its own line below the
 * title) instead of squeezed into the right-hand inline slot — the
 * `flex-shrink-0` slot can't bound a `w-full` flex-wrap child, so the
 * chips spill across the row and collide with the title (the overflow
 * the recurring-milestone row was showing).
 */
const STACKED_EDITORS = new Set([
  SPEC_KINDS.MILESTONE,
  SPEC_KINDS.RECURRING_MILESTONE,
  SPEC_KINDS.INCIDENT_LOG,
  SPEC_KINDS.FREE_TEXT,
]);

export function GoalRow({
  goal,
  spec,
  weekStart,
  weekEnd,
  activeLabel,
  mrs,
  events,
  tickets,
}) {
  const widget = spec.widget;

  // G1 — readiness gate. The hub (goal-widget.jsx) walks these same states
  // before it renders a fillable widget; check-in MUST obey the same gate so
  // a goal can't be data-entered here while it still says "finish setup" on
  // the Goals page (the bug: a milestone was fillable in check-in before its
  // context questions were answered, then the two surfaces disagreed).
  // Hooks run unconditionally and before any early return; readiness only
  // flips on a stable spec property, so hook order stays consistent per goal.
  const contextComplete = useIsContextComplete(spec);
  const hubLink = useHubLink();
  const readiness = goalReadiness(spec, contextComplete);
  if (readiness !== GOAL_READINESS.READY) {
    return (
      <SetupNeededRow
        goal={goal}
        spec={spec}
        widget={widget}
        readiness={readiness}
        href={hubLink("/goals")}
      />
    );
  }

  // SCORECARD goals expand into ONE banner row + N child rows, one per
  // sub-component. Each child renders a regular GoalRow with the
  // synthetic sub-spec, so the dispatch below picks the correct
  // editor (CODE_RUBRIC, RECURRING_MILESTONE, etc.) automatically.
  // The CODE_RUBRIC seed effect lives a step deeper inside
  // ScorecardChildRow so the goal-context is populated before
  // useGradedPrs reads it.
  if (widget === SPEC_KINDS.SCORECARD) {
    const components = spec?.scorecard?.components || [];
    if (components.length === 0) {
      return (
        <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-bg/40 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ScorecardBannerInner goal={goal} components={0} />
          </div>
          <div className="flex-shrink-0">
            <UnsupportedStub message="No components defined — add some in the dashboard widget" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <div className="rounded-md border border-border/60 bg-bg/30 px-3 py-2">
          <ScorecardBannerInner goal={goal} components={components.length} />
        </div>
        <div className="flex flex-col gap-1.5 pl-3">
          {components.map((component, i) => (
            <ScorecardChildRow
              key={i}
              parentGoal={goal}
              parentSpec={spec}
              component={component}
              index={i}
              weekStart={weekStart}
              weekEnd={weekEnd}
              activeLabel={activeLabel}
              mrs={mrs}
              events={events}
              tickets={tickets}
            />
          ))}
        </div>
      </div>
    );
  }

  // Filter integration data to this week's window once for any auto
  // widget that wants it.
  const weekMrs = useMemo(
    () => filterMrs(mrs, weekStart, weekEnd),
    [mrs, weekStart, weekEnd],
  );
  const weekEvents = useMemo(
    () => filterEvents(events, weekStart, weekEnd),
    [events, weekStart, weekEnd],
  );

  const titleBlock = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 rounded-[3px] border border-border px-1 py-px text-[9px] uppercase tracking-[0.6px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {kindLabel(widget)}
        </span>
        <div className="truncate text-[13px] font-medium text-fg">
          {goal?.title || spec.title || "Untitled"}
        </div>
      </div>
      <SubLine spec={spec} />
    </div>
  );

  const editor = (
    <EditorFor
      widget={widget}
      goal={goal}
      spec={spec}
      weekStart={weekStart}
      weekEnd={weekEnd}
      activeLabel={activeLabel}
      weekMrs={weekMrs}
      weekEvents={weekEvents}
      tickets={tickets}
    />
  );

  // Chip-list / multi-field editors get their own full-width line below
  // the title so their flex-wrap content actually wraps instead of
  // overflowing the row. Compact editors (counter/scale/auto) stay
  // inline on the right.
  if (STACKED_EDITORS.has(widget)) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg/40 px-3 py-2.5">
        {titleBlock}
        <div className="min-w-0">{editor}</div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-bg/40 px-3 py-2.5">
      {titleBlock}
      <div className="min-w-0 shrink-0">{editor}</div>
    </div>
  );
}

/**
 * G1 — the row a not-ready goal shows in check-in INSTEAD of a fillable
 * editor. No inputs here on purpose: you can't log progress against a goal
 * that isn't fully set up, and pretending otherwise is exactly the bug we're
 * fixing. Links back to Goals where the readiness state is resolved (answer
 * context questions, mark trackable, etc.). DELEGATED/UNTRACKABLE goals also
 * land here — they're informational, with no setup to finish.
 */
function SetupNeededRow({ goal, spec, widget, readiness, href }) {
  const actionable = readiness === GOAL_READINESS.NEEDS_CONTEXT;
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-dashed border-border bg-bg/20 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 rounded-[3px] border border-border px-1 py-px text-[9px] uppercase tracking-[0.6px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {kindLabel(widget)}
          </span>
          <div className="truncate text-[13px] font-medium text-muted-fg">
            {goal?.title || spec?.title || "Untitled"}
          </div>
        </div>
        <div className="text-[11px] text-muted-fg/80">
          {readinessLabel(readiness)}
        </div>
      </div>
      <Link
        href={href}
        className="shrink-0 self-center rounded-[3px] border border-border px-2 py-1 text-[10px] uppercase tracking-[0.5px] text-fg/80 transition-colors hover:bg-card-alt"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {actionable ? "Finish setup →" : "View in Goals →"}
      </Link>
    </div>
  );
}

/**
 * Banner row at the top of an expanded SCORECARD — shows the kind
 * chip + parent goal title + a small "N components" hint. Stays
 * compact (single line) so the expanded children below get the
 * visual focus.
 */
function ScorecardBannerInner({ goal, components }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-[3px] border border-border px-1 py-px text-[9px] uppercase tracking-[0.6px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        scorecard
      </span>
      <div className="truncate text-[13px] font-medium text-fg">
        {goal?.title || "Untitled"}
      </div>
      <span
        className="ml-auto shrink-0 text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {components} component{components === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/**
 * One row inside an expanded SCORECARD. Builds the synthetic sub-spec
 * + sub-goal, seeds CODE_RUBRIC goal-context once on mount (so the
 * check-in works even when the user hasn't opened the dashboard modal
 * first), then renders a regular GoalRow which picks the correct
 * editor by sub-widget kind.
 */
function ScorecardChildRow({
  parentGoal,
  parentSpec,
  component,
  index,
  weekStart,
  weekEnd,
  activeLabel,
  mrs,
  events,
  tickets,
}) {
  const subSpec = useMemo(
    () => buildSubSpec(parentSpec, component, index),
    [parentSpec, component, index],
  );
  const subGoal = useMemo(
    () => buildSubGoal(parentGoal, subSpec),
    [parentGoal, subSpec],
  );
  // Idempotent seed — only writes when the sub-id has no rubric
  // context yet AND the component is CODE_RUBRIC with seed items.
  useEffect(() => {
    seedRubricContextIfNeeded(subSpec.goalId, component);
  }, [subSpec.goalId, component]);
  return (
    <GoalRow
      goal={subGoal}
      spec={subSpec}
      weekStart={weekStart}
      weekEnd={weekEnd}
      activeLabel={activeLabel}
      mrs={mrs}
      events={events}
      tickets={tickets}
    />
  );
}

/* ─────────────────────── dispatch ─────────────────────── */

function EditorFor({
  widget,
  goal,
  spec,
  weekStart,
  weekEnd,
  activeLabel,
  weekMrs,
  weekEvents,
  tickets,
}) {
  switch (widget) {
    // Manual editors
    case SPEC_KINDS.COUNTER:
      return (
        <CounterEditor
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.SCALE:
      return (
        <ScaleEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.MILESTONE:
      return (
        <MilestoneEditor
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.FREE_TEXT:
      return (
        <FreeTextEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.DATE_LOG:
      return (
        <DateLogEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.BEFORE_AFTER:
      return (
        <BeforeAfterEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );

    // Auto read-outs computed from this week's integration data
    case SPEC_KINDS.MERGED_COUNT:
      return (
        <AutoReadout
          value={weekMrs.length}
          unit={weekMrs.length === 1 ? "merge" : "merges"}
          target={spec.source?.target}
          hint="auto · github/gitlab"
        />
      );
    case SPEC_KINDS.REVIEW_ROUNDS: {
      const v = avgReviewerComments(weekMrs);
      return (
        <AutoReadout
          value={v == null ? "—" : v.toFixed(2)}
          unit="rounds"
          target={spec.source?.target}
          hint="auto · this week's MRs"
        />
      );
    }
    case SPEC_KINDS.TURNAROUND: {
      const days = medianTurnaroundDays(weekMrs);
      const hours = days == null ? null : Math.round(days * 24);
      return (
        <AutoReadout
          value={hours == null ? "—" : hours}
          unit="h median"
          target={spec.source?.target}
          hint="auto · open → merge"
        />
      );
    }
    case SPEC_KINDS.LINKAGE: {
      const pct = linkagePct(weekMrs)?.pct ?? null;
      return (
        <AutoReadout
          value={pct == null ? "—" : pct}
          unit="%"
          target={spec.source?.target}
          hint="auto · % MRs linked"
        />
      );
    }
    case SPEC_KINDS.FIRST_PASS_RATE: {
      // firstPassRatePct returns `{ pct, clean, pingPong }` (or null).
      // The read-out displays a scalar — unwrap to .pct.
      const result = firstPassRatePct(weekMrs);
      const pct = result?.pct ?? null;
      return (
        <AutoReadout
          value={pct == null ? "—" : pct}
          unit="%"
          target={spec.source?.target}
          hint="auto · first-pass"
        />
      );
    }
    case SPEC_KINDS.TICKET_CYCLE:
      return (
        <AutoReadout
          value={Array.isArray(tickets) ? tickets.length : 0}
          unit="tickets"
          target={spec.source?.target}
          hint="auto · jira"
        />
      );

    case SPEC_KINDS.INCIDENT_LOG:
      return (
        <IncidentLogEditor
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );

    case SPEC_KINDS.RECURRING_MILESTONE:
      return (
        <RecurringMilestoneEditor
          goal={goal}
          spec={spec}
          activeLabel={activeLabel}
        />
      );

    case SPEC_KINDS.CODE_RUBRIC:
      return (
        <CodeRubricEditor
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
        />
      );

    // Phase D/E widgets with richer state — full inline editors land in
    // a later PR. For now, point the user at the dashboard widget.
    case SPEC_KINDS.SCORECARD:
      return <UnsupportedStub message="Edit components from the dashboard widget" />;
    case SPEC_KINDS.DEPLOY_FREQUENCY:
    case SPEC_KINDS.LEAD_TIME:
    case SPEC_KINDS.BUILD_PASS_RATE:
      return <UnsupportedStub message="Tracked via CI/CD — visible on the dashboard" />;

    default:
      return <UnsupportedStub message={`No editor for "${widget}" yet`} />;
  }
}

/* ─────────────────────── chrome ─────────────────────── */

function SubLine({ spec }) {
  const target = spec.manual?.target || spec.source?.target;
  const cadence = spec.manual?.cadence;
  const bits = [];
  if (cadence) bits.push(cadence);
  if (target) bits.push(`target ${target.op}${target.value}${spec.manual?.unit ? " " + spec.manual.unit : ""}`);
  if (bits.length === 0) return null;
  return (
    <div
      className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {bits.join(" · ")}
    </div>
  );
}

function kindLabel(widget) {
  // Compact friendly label for the chip — falls back to a sliced
  // version of the SPEC_KINDS constant. We avoid pulling in the whole
  // SPEC_KIND_META table from shared since this is purely cosmetic.
  switch (widget) {
    case SPEC_KINDS.COUNTER:
      return "counter";
    case SPEC_KINDS.SCALE:
      return "scale";
    case SPEC_KINDS.MILESTONE:
      return "milestone";
    case SPEC_KINDS.FREE_TEXT:
      return "note";
    case SPEC_KINDS.DATE_LOG:
      return "date-log";
    case SPEC_KINDS.BEFORE_AFTER:
      return "before/after";
    case SPEC_KINDS.MERGED_COUNT:
      return "merges";
    case SPEC_KINDS.REVIEW_ROUNDS:
      return "rounds";
    case SPEC_KINDS.TURNAROUND:
      return "turnaround";
    case SPEC_KINDS.LINKAGE:
      return "linkage";
    case SPEC_KINDS.FIRST_PASS_RATE:
      return "first-pass";
    case SPEC_KINDS.TICKET_CYCLE:
      return "tickets";
    case SPEC_KINDS.INCIDENT_LOG:
      return "incidents";
    case SPEC_KINDS.RECURRING_MILESTONE:
      return "recurring";
    case SPEC_KINDS.CODE_RUBRIC:
      return "rubric";
    case SPEC_KINDS.SCORECARD:
      return "scorecard";
    case SPEC_KINDS.DEPLOY_FREQUENCY:
      return "deploys";
    case SPEC_KINDS.LEAD_TIME:
      return "lead-time";
    case SPEC_KINDS.BUILD_PASS_RATE:
      return "build-pass";
    default:
      return String(widget || "").toLowerCase().slice(0, 14);
  }
}

/* ─────────────────────── filtering ─────────────────────── */

function filterMrs(mrs, start, end) {
  if (!Array.isArray(mrs)) return [];
  const s = start.getTime();
  const e = end.getTime();
  return mrs.filter((m) => {
    if (!m.merged_at) return false;
    const t = new Date(m.merged_at).getTime();
    return t >= s && t < e;
  });
}

function filterEvents(events, start, end) {
  if (!Array.isArray(events)) return [];
  const s = start.getTime();
  const e = end.getTime();
  return events.filter((ev) => {
    const t = new Date(ev.created_at || 0).getTime();
    return t >= s && t < e;
  });
}
