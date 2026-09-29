"use client";

/**
 * Focus — the split master/detail view: a thin index rail of every goal,
 * grouped under its objective, and the selected goal in full on the right.
 *
 * The detail pane does NOT reimplement widget content. It mounts the same
 * `<GoalWidget>` + `<GoalTierLadder>` every other surface uses, so filling a
 * window here is the same code path (and the same validation, locks and
 * grading) as filling it anywhere else. This file owns layout and selection
 * only.
 */

import { ChevronDown, Sparkles } from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { GoalTierBadge, GoalTierLadder } from "@/features/goal-tiers";
import {
  GoalWidget,
  goalReadiness,
  readinessHint,
  readinessShortLabel,
} from "@/features/goal-widgets";
import { specCadence } from "@/features/goal-specs";
import { useIsContextComplete } from "@/features/goal-context";
import { cn } from "@/lib/cn";
import { humanizeKind } from "./flow-row-meta";
import { tierDotColor } from "./goal-status";
import { WindowStrip } from "./window-strip";
import { ASSIGNED_ROOT_ID } from "@espace-devhub/shared/goal-specs";
import { AssignedBadge } from "@/features/assigned-goals";

export function FocusView({
  rows,
  selected,
  selectedId,
  onSelect,
  collapsedIds,
  onToggleGroup,
  focusedId,
  registerRow,
  density = "comfortable",
  onClassify,
}) {
  const compact = density === "dense";
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
      <Card padding={10} className="flex flex-col gap-0.5">
        {rows.map((row) => {
          const collapsed = collapsedIds.has(row.l1.id);
          return (
            <div key={row.l1.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => onToggleGroup(row.l1.id)}
                aria-expanded={!collapsed}
                className="flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 pb-1 pt-2.5 text-left"
              >
                <Label className="min-w-0 flex-1 truncate" title={row.l1.title || "Untitled objective"}>
                  {row.l1.title || "Untitled objective"}
                </Label>
                {row.l1.id === ASSIGNED_ROOT_ID ? (
                  <AssignedBadge names={row.l2s.map((x) => x.goal?.assigned?.byName)} />
                ) : null}
                <ChevronDown
                  size={13}
                  className={cn(
                    "shrink-0 text-muted-fg transition-transform",
                    collapsed ? "-rotate-90" : "",
                  )}
                />
              </button>

              {collapsed
                ? null
                : row.l2s.map((it) => {
                    const on = it.goal.id === selectedId;
                    return (
                      <button
                        key={it.goal.id}
                        type="button"
                        data-goal-row={it.goal.id}
                        ref={(el) => registerRow(it.goal.id, el)}
                        tabIndex={focusedId === it.goal.id ? 0 : -1}
                        aria-current={on ? "true" : undefined}
                        onClick={() => onSelect(it.goal.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-left",
                          compact ? "py-1.5" : "py-2",
                          on ? "bg-card-alt" : "",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="h-[5px] w-[5px] shrink-0 rounded-full"
                          style={{ background: tierDotColor(it.status.tier) }}
                        />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-[12.5px]",
                            on ? "font-bold text-fg" : "font-medium text-muted-fg",
                          )}
                          title={it.goal.title || it.spec?.title || "(untitled)"}
                        >
                          {it.goal.title || it.spec?.title || "(untitled)"}
                        </span>
                      </button>
                    );
                  })}
            </div>
          );
        })}
      </Card>

      {selected ? (
        <GoalDetail item={selected} compact={compact} onClassify={onClassify} />
      ) : (
        <Card padding={24} className="text-[13px] text-muted-fg">
          Select a goal from the list to see it in full.
        </Card>
      )}
    </div>
  );
}

function GoalDetail({ item, compact, onClassify }) {
  const { goal, spec, status, invalidSpec } = item;
  const contextComplete = useIsContextComplete(spec);
  const readiness = goalReadiness(spec, contextComplete);
  const title = goal.title || spec?.title || "(untitled)";
  const cadence = spec ? specCadence(spec) : null;
  // The badge already says "No tracker yet" for a goal without a spec.
  const meta = [spec ? humanizeKind(spec.widget) : null, cadence, goal.parentL1Title]
    .filter(Boolean)
    .join(" · ");
  // The readiness badge is a short state word; the sentence saying what to
  // do sits under the title and points at the tracker below it. (The status
  // badge already says "Needs setup" for these, so only the readiness
  // badge is shown then — two badges saying the same thing is noise.)
  const notReady = readiness !== "ready" && !!spec;
  const readinessTone =
    readiness === "needs-context" || readiness === "pending-approval" || readiness === "changes-requested"
      ? "lemon"
      : "neutral";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card padding={compact ? 20 : 24} className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {spec ? <GoalTierBadge goalId={goal.id} spec={spec} /> : null}
          {notReady ? (
            <Badge tone={readinessTone}>{readinessShortLabel(readiness) || "Not ready"}</Badge>
          ) : (
            <span title={status.description}>
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          )}
          {!notReady && status.reason ? (
            <span className="text-[11.5px] font-semibold text-fg">{status.reason}</span>
          ) : null}
          <span className="min-w-0 truncate text-[11.5px] font-semibold text-muted-fg">
            {meta}
          </span>
        </div>

        <h2 className="text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-fg">
          {title}
        </h2>

        {notReady ? (
          <p className="text-[12.5px] leading-[1.5] text-muted-fg">{readinessHint(readiness)}</p>
        ) : null}

        {status.cyc ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-bold text-fg">This cycle</span>
              <span
                className="text-[11.5px] font-semibold tabular-nums text-muted-fg"
                title="Of the windows due so far (ended since this tracker started, plus this one once it's logged), how many are logged or settled"
              >
                {status.logged && status.logged.due > 0
                  ? `${status.logged.done} of ${status.logged.due} due so far logged`
                  : "Nothing due yet"}
              </span>
            </div>
            <WindowStrip goalId={goal.id} cyc={status.cyc} showLabels={!compact} height={15} />
          </div>
        ) : null}
      </Card>

      {spec ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* `bare`: the card above already names the goal — the widget
              doesn't print the title a second time. */}
          <Card padding={20} className="min-w-0">
            <GoalWidget spec={spec} goal={goal} bare />
          </Card>
          <GoalTierLadder spec={spec} rubric={goal.rubric || goal.parentL1Rubric || null} />
        </div>
      ) : invalidSpec ? (
        <Card padding={24} className="flex flex-col items-start gap-3">
          <span className="text-[15px] font-bold text-fg">Tracker data is invalid</span>
          <span className="text-[13px] leading-[1.5] text-muted-fg">
            This goal has a saved tracker that no longer passes validation (its
            shape predates a change), so it can&apos;t be shown. Re-analyze the
            goal to rebuild it.
          </span>
          <Button variant="tint" tone="lav" size="sm" onClick={onClassify}>
            <Sparkles size={13} />
            Re-analyze this goal
          </Button>
        </Card>
      ) : (
        <Card padding={24} className="flex flex-col items-start gap-3">
          <span className="text-[15px] font-bold text-fg">This goal has no tracker yet</span>
          <span className="text-[13px] leading-[1.5] text-muted-fg">
            Classify it and the analyst picks the tracker, the cadence and the
            achievement levels it should be graded against.
          </span>
          <Button variant="tint" tone="lav" size="sm" onClick={onClassify}>
            <Sparkles size={13} />
            Classify this goal
          </Button>
        </Card>
      )}
    </div>
  );
}
