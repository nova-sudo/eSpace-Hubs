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
import { GoalWidget, goalReadiness, readinessLabel } from "@/features/goal-widgets";
import { specCadence } from "@/features/goal-specs";
import { useIsContextComplete } from "@/features/goal-context";
import { cn } from "@/lib/cn";
import { humanizeKind } from "./flow-row-meta";
import { tierDotColor } from "./goal-status";
import { WindowStrip } from "./window-strip";
import { ASSIGNED_ROOT_ID } from "@espace-devhub/shared/goal-specs";

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
                <Label caps className="min-w-0 flex-1 truncate">
                  {row.l1.title || "Untitled objective"}
                </Label>
                {row.l1.id === ASSIGNED_ROOT_ID ? <Badge tone="sky">Shared</Badge> : null}
                <ChevronDown
                  size={13}
                  className={cn(
                    "shrink-0 text-dim-fg transition-transform",
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
                          title={it.spec?.title || it.goal.title || "(untitled)"}
                        >
                          {it.spec?.title || it.goal.title || "(untitled)"}
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
  const { goal, spec, status } = item;
  const contextComplete = useIsContextComplete(spec);
  const readiness = goalReadiness(spec, contextComplete);
  const title = spec?.title || goal.title || "(untitled)";
  const cadence = spec ? specCadence(spec) : null;
  const meta = [spec ? humanizeKind(spec.widget) : "Unclassified", cadence, goal.parentL1Title]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card padding={compact ? 20 : 24} className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {spec ? <GoalTierBadge goalId={goal.id} spec={spec} /> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
          {readiness !== "ready" && spec ? (
            <Badge
              tone={
                readiness === "needs-context" || readiness === "pending-approval"
                  ? "lemon"
                  : "neutral"
              }
            >
              {readinessLabel(readiness) || "Not ready"}
            </Badge>
          ) : null}
          <span className="min-w-0 truncate text-[11.5px] font-semibold text-muted-fg">
            {meta}
          </span>
        </div>

        <h2 className="text-[19px] font-bold leading-[1.25] tracking-[-0.02em] text-fg">
          {title}
        </h2>

        {status.cyc ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-bold text-fg">Cycle</span>
              <span className="text-[11.5px] font-semibold tabular-nums text-muted-fg">
                {status.cyc.filledCount} of {status.cyc.total} logged
              </span>
            </div>
            <WindowStrip goalId={goal.id} cyc={status.cyc} showLabels={!compact} height={15} />
          </div>
        ) : null}
      </Card>

      {spec ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <GoalWidget spec={spec} goal={goal} />
          <GoalTierLadder spec={spec} />
        </div>
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
