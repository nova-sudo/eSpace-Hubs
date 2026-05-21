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

import { useMemo } from "react";
import { SPEC_KINDS } from "@/features/goal-specs";
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
} from "./editors";

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

  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-bg/40 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className="rounded-[3px] border border-border px-1 py-px text-[9px] uppercase tracking-[0.6px] text-muted-fg"
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

      <div className="flex-shrink-0">
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
      </div>
    </div>
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

    // Phase D/E widgets with richer state — full inline editors land in
    // a later PR. For now, point the user at the dashboard widget.
    case SPEC_KINDS.CODE_RUBRIC:
      return <UnsupportedStub message="Grade PRs from the dashboard widget" />;
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
