"use client";

import Link from "next/link";
import { BentoTile } from "@/components/ui";
import { ProviderStateCallout } from "@/features/integrations";
import { useSnapshots } from "@/features/snapshots";
import { useHubLink } from "@/features/hubs";
import { fullDate } from "@/lib/date";

/**
 * Compact-strip variant: the section's row 5 is one grid-row tall (4:1 ratio
 * with the goals tile above), so we condense to ONE summary line — the most
 * recent snapshot — plus a "See all" link to the full history page. Counts
 * are shown alongside so the user still gets the gestalt at a glance.
 */
export function SnapshotsTile() {
  const { snapshots } = useSnapshots();
  const latest = snapshots[0];
  const total = snapshots.length;
  const link = useHubLink();

  return (
    <BentoTile
      col="span 4"
      row="span 1"
      label={`Weekly snapshots${total > 0 ? ` · ${total} captured` : ""}`}
      right={
        <Link
          href={link("/snapshots")}
          className="font-bold text-accent hover:underline"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          SEE ALL ↗
        </Link>
      }
    >
      {!latest ? (
        <ProviderStateCallout
          kind="empty"
          message="No snapshots yet — capture one weekly to build your review history."
          actionHref={link("/snapshots")}
          actionLabel="Capture now"
        />
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1">
          <div className="text-[13px] font-semibold leading-tight">
            {latest.note || "Latest snapshot"}
          </div>
          <div
            className="flex items-center justify-between gap-2 text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
          >
            <span>{fullDate(latest.capturedAt)}</span>
            <span className="text-accent">
              {latest.merged ?? 0} merged · {latest.reviews ?? 0} reviews ·{" "}
              {latest.linkage ?? 0}%
            </span>
          </div>
          {latest.partial ? (
            <div
              className="mt-0.5 text-[10px] text-[#b45309]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              ⚠ Partial data
              {latest.gaps?.length > 0
                ? ` — ${latest.gaps.join(", ")} unavailable`
                : ""}
            </div>
          ) : null}
        </div>
      )}
    </BentoTile>
  );
}
