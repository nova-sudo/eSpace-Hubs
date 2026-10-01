"use client";

/**
 * The big number at the top of an AUTO widget, through `<LiveValue>`: a
 * number-sized skeleton on a first load, the last-known value (never "…",
 * "!" or a 0) while a refresh runs or after one fails, and the freshness /
 * reason line under the row. The plain "updated N min ago" is left to the
 * provenance chip, which already says it.
 *
 *   const ds = useDataSource(spec.source);
 *   const live = useSourceLiveStatus(spec.source, ds, { hasValue: count != null });
 *   <WidgetHeadline status={live} after={<Badge …/>}>{count}</WidgetHeadline>
 */

import { FreshnessNote, LiveValue } from "@/components/ui";
import { cn } from "@/lib/cn";

export function WidgetHeadline({ status, children, after, skeleton = "w-[2.5ch]", className }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <LiveValue
          status={status}
          hideNote
          skeleton={skeleton}
          className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]"
          messageClassName="text-[13px] sm:text-[13px]"
        >
          {children}
        </LiveValue>
        {status?.hasValue ? after : null}
      </div>
      <FreshnessNote status={status} showQuiet={false} />
    </div>
  );
}
