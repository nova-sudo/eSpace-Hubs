"use client";

/**
 * Snapshot nudge — reminds the user to capture this week's reading (the
 * weekly snapshots are what the trend arrows on every card compare). The
 * goal queue itself now renders as the Focus hero + the "Also needs you"
 * rows on the Intelligence page, so this component's job has narrowed to
 * just the snapshot prompt; `queue` / `fillHref` are kept as accepted props
 * for back-compat with the exported signature but no longer drive a row
 * list here.
 *
 * Two honesty rules:
 *   - Nothing renders until the snapshot store has HYDRATED. Before that
 *     `snapshots` is `[]`, which used to flash the nudge on every load and
 *     leave it stuck when the fetch failed.
 *   - The week checked is the week the button SAVES (`weekLabel()`, the
 *     current one, compared by `weekKey()`) — it used to check the last completed week, so capturing
 *     never cleared the card. Completed weeks are the auto-snapshotter's job.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui";
import { hasSnapshotThisWeek, useSnapshotNow, useSnapshots } from "@/features/snapshots";
import { weekLabel } from "@/lib/date";

export function ActionQueue({ queue: _queue, fillHref: _fillHref, snapshotHref }) {
  // `week` is only the human label for the copy; "captured this week?" is
  // the shared predicate Evidence uses too (features/snapshots/this-week).
  const week = useMemo(() => weekLabel(), []);

  const { snapshots, fetched } = useSnapshots();
  const snapshotNow = useSnapshotNow();
  const [saving, setSaving] = useState(false);

  const snapshotPending = useMemo(
    () => fetched && !hasSnapshotThisWeek(snapshots),
    [snapshots, fetched],
  );

  if (!snapshotPending) return null;

  const capture = async () => {
    setSaving(true);
    try {
      // The hook is moving to a `{ ok, error }` result; until then a plain
      // resolve means the store accepted it (it rolls back + logs otherwise).
      const r = await snapshotNow("");
      if (r && r.ok === false) {
        toast.error("Couldn't save the snapshot", {
          description: r.error?.message || "Try again in a moment.",
        });
      } else if (r && r.ok === true) {
        toast.success(`Snapshot saved — ${week}`);
      }
    } catch (err) {
      toast.error("Couldn't save the snapshot", { description: err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card tone="sky" padding={20} className="flex items-center gap-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold">Capture this week&rsquo;s snapshot</div>
        <div
          className="mt-0.5 text-[12.5px]"
          title="A snapshot freezes this week's numbers. Next week's snapshot is compared against it to draw the up/down arrows on each goal."
        >
          {week} · gives each goal its up or down arrow next week
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Soft: the hero's "Fill this week" is the page's one ink button. */}
        <Button size="sm" variant="soft" onClick={capture} disabled={saving}>
          {saving ? "Saving…" : "Snapshot now"}
        </Button>
        {snapshotHref ? (
          <Link href={snapshotHref} className="link-target text-[12.5px] font-semibold underline-offset-2 hover:underline">
            History
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
