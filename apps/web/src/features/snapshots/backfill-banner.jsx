"use client";

/**
 * Backfill banner — surfaces above the page content. Self-hides when
 * there's nothing to backfill, expands into a progress line while a
 * run is in flight.
 *
 * Mount this once at the AppShell level. The hook (`useBackfill`)
 * decides whether to surface anything via its `missingWeeks` count.
 */

import { Button, Card } from "@/components/ui";
import { useBackfill } from "./use-backfill";

export function BackfillBanner() {
  const { run, isRunning, progress, missingWeeks } = useBackfill();

  if (!isRunning && missingWeeks === 0) return null;

  return (
    <div className="px-4 sm:px-10 pt-3" role="status" aria-live="polite">
      <Card tone="sky" radius="lg" className="flex items-center justify-between gap-3 py-3">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[12px] font-semibold opacity-80">Cycle history</span>
          <span className="text-[13px] font-semibold">
            {isRunning && progress
              ? `Building week ${progress.done} of ${progress.total}…`
              : `${missingWeeks} week${missingWeeks === 1 ? "" : "s"} missing — backfill to unlock year-to-date compliance`}
          </span>
        </div>
        <Button size="sm" variant="soft" onClick={() => run()} disabled={isRunning}>
          {isRunning ? "Running…" : "Backfill"}
        </Button>
      </Card>
    </div>
  );
}
