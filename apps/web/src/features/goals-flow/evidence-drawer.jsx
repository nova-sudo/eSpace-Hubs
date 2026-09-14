"use client";

/**
 * Evidence drawer — resolves B1 (Snapshots), B2 (Export), B3 (Commits) from
 * FEATURE_PARITY.md: the current Goals page's evidence strip doesn't fit
 * the flow map's "one row per goal" premise, so instead of cramming three
 * more tiles into the canvas, it moves to a slide-out drawer toggled from
 * the title bar.
 *
 * Data comes from the SAME hooks the current tiles use
 * (`useSnapshots`, `useCombinedEventsSince`) — both legitimate shared-domain
 * imports. The export actions link out to /evidence rather than duplicating
 * its markdown/PDF generation here: `evidence` is a PRODUCT SURFACE (owns
 * its own page), and `goals-flow` (also a product surface) isn't allowed to
 * reach into another product surface's internals — only into shared
 * domains. `ExportTile`'s own PDF button already follows this same
 * link-out pattern.
 */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { IconButton, Label } from "@/components/ui";
import { useSnapshots } from "@/features/snapshots";
import { useCombinedEventsSince } from "@/features/integrations";
import { useHubLink } from "@/features/hubs";
import { fullDate } from "@/lib/date";
import { fmtRelative } from "@/lib/fmt";
import { isoDaysAgo } from "@/lib/date";

export function EvidenceDrawer({ onClose }) {
  const link = useHubLink();
  const { snapshots } = useSnapshots();
  const { data } = useCombinedEventsSince(isoDaysAgo(14));
  const commits = (data || [])
    .filter((e) => e.action_name?.startsWith("pushed") && e.push_data?.commit_title)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)
    .map((e) => ({
      sha: (e.push_data.commit_to || e.push_data.commit_from || "").slice(0, 7),
      msg: e.push_data.commit_title,
      when: fmtRelative(e.created_at),
    }));

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-fg/40" onClick={onClose} />
      <aside
        aria-label="Evidence"
        className="fixed right-0 top-0 z-50 flex h-full w-[340px] max-w-[90vw] flex-col overflow-y-auto bg-card"
        style={{ boxShadow: "var(--shadow-float)", borderTopLeftRadius: "var(--radius-xl)", borderBottomLeftRadius: "var(--radius-xl)" }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4">
          <span className="text-[18px] font-bold tracking-[-0.01em] text-fg">Evidence</span>
          <IconButton label="Close evidence" size="sm" onCard onClick={onClose}>
            <ArrowUpRight size={15} className="rotate-45" />
          </IconButton>
        </div>

        <div className="flex flex-col gap-5 p-5">
          <section className="flex flex-col gap-2">
            <Label>Export bundle · YTD</Label>
            <span className="text-[12.5px] leading-[1.5] text-muted-fg">
              goals · readings · logged evidence · tier verdicts
            </span>
            <Link
              href={link("/evidence")}
              className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-bold text-fg"
            >
              Open evidence builder
              <ArrowUpRight size={13} />
            </Link>
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Weekly snapshots · {snapshots.length}</Label>
              <Link href={link("/snapshots")} className="text-[12px] font-bold text-fg">
                See all
              </Link>
            </div>
            {snapshots.length === 0 ? (
              <span className="text-[12px] text-dim-fg">No snapshots yet.</span>
            ) : (
              snapshots.slice(0, 3).map((s) => (
                <div key={s.capturedAt} className="flex flex-col gap-0.5 border-b border-line pb-2">
                  <span className="text-[12.5px] font-bold text-fg">{s.note || "Snapshot"}</span>
                  <span className="text-[11.5px] text-muted-fg">
                    {fullDate(s.capturedAt)} · {s.merged ?? 0} merged · {s.reviews ?? 0} reviews
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <Label>Recent commits · {commits.length} in 14d</Label>
            {commits.length === 0 ? (
              <span className="text-[12px] text-dim-fg">No recent pushes.</span>
            ) : (
              commits.map((c) => (
                <div key={c.sha + c.when} className="flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11.5px] font-bold text-fg">{c.sha}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{c.msg}</span>
                  </div>
                  <span className="text-[11.5px] text-dim-fg">{c.when} ago</span>
                </div>
              ))
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
