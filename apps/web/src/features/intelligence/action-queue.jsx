"use client";

/**
 * Snapshot nudge — reminds the user to capture this week's reading (feeds
 * the trend arrows on every card). The goal queue itself now renders as the
 * Focus hero + the "Also needs you" rows on the Intelligence page, so this
 * component's job has narrowed to just the snapshot prompt; `queue` /
 * `fillHref` are kept as accepted props for back-compat with the exported
 * signature but no longer drive a row list here.
 */

import { useMemo } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { useSnapshots } from "@/features/snapshots";
import { resolveCompletedWorkWeek } from "@/lib/date";

export function ActionQueue({ queue: _queue, fillHref: _fillHref, snapshotHref }) {
  // Same most-recent completed work week the cards + check-in write to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(() => resolveCompletedWorkWeek(), []);

  // Has this week's snapshot been captured? Snapshots feed the trend
  // arrows, so a missing one is a real "do next" — surfaced even when no
  // goal needs filling.
  const { snapshots } = useSnapshots();
  const snapshotPending = useMemo(
    () => !snapshots.some((s) => s.week === week.weekLabel),
    [snapshots, week],
  );

  if (!snapshotPending) return null;

  return (
    <Card tone="sky" padding={20} className="flex items-center gap-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold">Capture this week&rsquo;s snapshot</div>
        <div className="mt-0.5 text-[12.5px] opacity-80">{week.weekLabel} · feeds your trend arrows</div>
      </div>
      <Link href={snapshotHref || "#"}>
        <Button size="sm">Snapshot</Button>
      </Link>
    </Card>
  );
}
