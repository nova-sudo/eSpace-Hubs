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
    <aside
      aria-label="Evidence"
      className="flex h-full w-[320px] max-w-[85vw] shrink-0 flex-col overflow-y-auto border-l border-border bg-panel"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.7px" }}
        >
          Evidence
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close evidence"
          className="border-0 bg-transparent text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer" }}
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-4.5 p-4">
        <section className="flex flex-col gap-2">
          <span
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.6px" }}
          >
            Export bundle · YTD
          </span>
          <span className="text-dim-fg" style={{ fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.5 }}>
            goals · readings · logged evidence · tier verdicts
          </span>
          <Link
            href={link("/evidence")}
            className="inline-flex w-fit items-center rounded-[var(--radius-sub)] border border-accent bg-accent px-2.5 py-1.5 text-accent-on"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}
          >
            Open evidence builder ↗
          </Link>
        </section>

        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.6px" }}
            >
              Weekly snapshots · {snapshots.length}
            </span>
            <Link
              href={link("/snapshots")}
              className="text-accent"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}
            >
              see all ↗
            </Link>
          </div>
          {snapshots.length === 0 ? (
            <span className="text-dim-fg" style={{ fontSize: 11 }}>
              No snapshots yet.
            </span>
          ) : (
            snapshots.slice(0, 3).map((s) => (
              <div key={s.capturedAt} className="flex flex-col gap-0.5 border-b border-border pb-1.5">
                <span className="text-[12px] font-semibold">{s.note || "Snapshot"}</span>
                <span className="text-muted-fg" style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}>
                  {fullDate(s.capturedAt)} · {s.merged ?? 0} merged · {s.reviews ?? 0} reviews
                </span>
              </div>
            ))
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <span
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.6px" }}
          >
            Recent commits · {commits.length} in 14d
          </span>
          {commits.length === 0 ? (
            <span className="text-dim-fg" style={{ fontSize: 11 }}>
              No recent pushes.
            </span>
          ) : (
            commits.map((c) => (
              <div key={c.sha + c.when} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-bold text-accent" style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}>
                    {c.sha}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{c.msg}</span>
                </div>
                <span className="text-dim-fg" style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>
                  {c.when} ago
                </span>
              </div>
            ))
          )}
        </section>
      </div>
    </aside>
  );
}
