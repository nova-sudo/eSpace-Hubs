"use client";

/**
 * Renders in place of a widget when a COMPOSED "Build Your Own" tracker
 * is awaiting (or was sent back by) manager approval — `spec.approval.status`
 * is "pending" or "rejected" (P4).
 *
 * Read-only: the tracker can't be filled or graded until the manager
 * approves. On "rejected" (changes requested) the dev can revise, which
 * re-opens the compose modal and resubmits as pending.
 */

import { useEffect } from "react";
import { Badge, Button } from "@/components/ui";
import { WidgetShell } from "../widget-shell";
import { fetchSpecs } from "@/features/goal-specs";

/**
 * Nothing pushes this tile a signal when the manager decides. Notifications
 * are fetch-on-open, not push (see notifications-store.js), and the
 * goal-specs store hydrates exactly once per session (specs-store.js /
 * use-goal-specs.js) — so a report who has the dashboard open when their
 * manager approves sees "Pending approval" forever, until a full page
 * reload flushes the module state. Polling is the cheap fix: while this
 * card is genuinely pending, re-fetch specs periodically; the instant
 * approval/rejection lands, `spec.approval.status` changes, GoalWidget stops
 * rendering this card, and the poll stops with it.
 */
const PENDING_POLL_MS = 30_000;

export function PendingApprovalCard({ spec, goal, className, onRetry, onRevise }) {
  const rejected = spec?.approval?.status === "rejected";
  const note = spec?.approval?.note;
  const reviewer = spec?.approval?.reviewedByName;

  // Only while pending — "rejected" is waiting on the DEV to revise, not the
  // manager, so there's nothing new to poll for until they act.
  useEffect(() => {
    if (rejected) return undefined;
    const id = setInterval(() => {
      void fetchSpecs();
    }, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [rejected]);

  return (
    <WidgetShell
      spec={spec}
      rightChip={<Badge tone={rejected ? "peach" : "lemon"}>{rejected ? "Changes requested" : "Pending approval"}</Badge>}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
      footer={
        rejected && onRevise ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRevise}>
            Revise &amp; resubmit
          </Button>
        ) : null
      }
    >
      <div className="flex h-full flex-col justify-between gap-2 text-[13px] leading-[1.5] text-muted-fg">
        <div>
          {rejected ? (
            <>
              <span className="font-bold text-fg">{reviewer || "Your manager"}</span> asked
              for changes before this tracker goes live.
            </>
          ) : (
            <>
              This <span className="font-bold text-fg">Build-Your-Own</span> tracker is
              waiting on your manager's approval — it goes live once they sign off.
            </>
          )}
        </div>
        {rejected && note ? (
          <div className="text-[12px] italic text-muted-fg">&ldquo;{note}&rdquo;</div>
        ) : null}
      </div>
    </WidgetShell>
  );
}
