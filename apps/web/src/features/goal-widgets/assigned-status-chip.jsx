"use client";

/**
 * The strip a SHARED goal shows its assignee: who shared it, and where the
 * period that matters right now stands — open (due by …), or the oldest
 * still-missing one. Uses the same shared `periodStatuses` as the manager's
 * grid, so "late" here is exactly "late" there.
 */

import { useMemo } from "react";
import { periodStatuses } from "@espace-devhub/shared/goal-specs";
import { Badge } from "@/components/ui";
import { shortDate } from "@/lib/date";
import { useGoalInputs } from "@/features/goal-inputs";

const HOUR_MS = 3_600_000;

export function AssignedStatusChip({ spec, assigned }) {
  const { entries } = useGoalInputs(spec?.goalId);
  const focus = useMemo(() => {
    if (!spec) return null;
    const cells = periodStatuses({
      spec,
      entries,
      now: Date.now(),
      graceMs: (assigned?.graceHours || 0) * HOUR_MS,
      timeZone: assigned?.timeZone || "UTC",
    });
    return (
      cells.find((c) => c.status === "missing") ||
      cells.find((c) => c.status === "open") ||
      null
    );
  }, [spec, entries, assigned?.graceHours, assigned?.timeZone]);

  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
      <Badge tone="sky">
        Shared{assigned?.byName ? ` by ${assigned.byName}` : ""}
      </Badge>
      {focus?.status === "missing" ? (
        <Badge tone="peach" dot>
          {focus.label} missing · was due {shortDate(focus.deadline)}
        </Badge>
      ) : focus?.status === "open" ? (
        <Badge tone="lemon" dot>
          {focus.label} due {shortDate(focus.deadline)}
        </Badge>
      ) : null}
    </div>
  );
}
