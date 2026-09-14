"use client";

/**
 * Renders in place of a widget when `spec.untrackable` is set.
 *
 * Visual cousin of `<DelegatedCard>` — calm, no-demand tile that shows
 * the user *why* the goal isn't being tracked. The footer "track it"
 * action clears the `untrackable` flag and the spec's underlying widget
 * choice takes over the slot.
 *
 * The reason is treated as user-authored copy (whether the AI emitted
 * it or the user typed it in the Review pane). We italicise it lightly
 * to read as a note rather than a system message.
 */

import { Badge, Button } from "@/components/ui";
import { WidgetShell } from "../widget-shell";

export function UntrackableCard({ spec, goal, className, onRetry, onClearUntrackable }) {
  const reason = spec?.untrackable?.reason;

  return (
    <WidgetShell
      spec={spec}
      rightChip={<Badge>Untrackable</Badge>}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
      footer={
        onClearUntrackable ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClearUntrackable}>
            Track it
          </Button>
        ) : null
      }
    >
      <div className="flex h-full flex-col justify-between gap-2 text-[13px] leading-[1.5] text-muted-fg">
        <div>
          <span className="font-bold text-fg">Not currently tracked</span> — see reason below.
        </div>
        {reason ? (
          <div className="text-[12px] italic text-muted-fg">&ldquo;{reason}&rdquo;</div>
        ) : (
          <div className="text-[12px] italic text-dim-fg">No reason recorded.</div>
        )}
      </div>
    </WidgetShell>
  );
}
