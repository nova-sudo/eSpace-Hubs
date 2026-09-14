"use client";

/**
 * Renders in place of a widget when `spec.delegated.delegated === true`.
 *
 * The point: calm, no-demand card that tells the user "this goal is judged
 * by X, you don't self-track it". Keeps the grid uniform; the user can
 * untoggle delegation via the footer action and get the tracker back.
 */

import { Badge, Button } from "@/components/ui";
import { WidgetShell } from "../widget-shell";

const JUDGE_LABEL = {
  manager: "Your manager",
  senior: "A senior engineer",
  peer: "A peer reviewer",
};

export function DelegatedCard({ spec, goal, className, onRetry, onUnsetDelegation }) {
  const judge = spec?.delegated?.judge;
  const note = spec?.delegated?.note;
  const who = JUDGE_LABEL[judge] || "Someone on your team";

  return (
    <WidgetShell
      spec={spec}
      rightChip={<Badge tone="sky">Delegated</Badge>}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
      footer={
        onUnsetDelegation ? (
          <Button type="button" variant="ghost" size="sm" onClick={onUnsetDelegation}>
            Self-track
          </Button>
        ) : null
      }
    >
      <div className="flex h-full flex-col justify-between gap-2 text-[13px] leading-[1.5] text-muted-fg">
        <div>
          <span className="font-bold text-fg">{who}</span> evaluates this goal —
          no self-tracking required.
        </div>
        {note ? <div className="text-[12px] italic text-muted-fg">{note}</div> : null}
      </div>
    </WidgetShell>
  );
}
