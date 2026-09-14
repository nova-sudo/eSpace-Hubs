"use client";

/**
 * Sticky sidebar "Review packet" card: goal-standing compliance at a
 * glance + the "Compile into review" CTA that switches to the document
 * builder. Goal-oriented — no integration tallies.
 */

import { Badge, Button, Card, Stat } from "@/components/ui";

const ROWS = [
  { key: "onTrack", label: "On track", tone: "mint" },
  { key: "inProgress", label: "In progress", tone: "lav" },
  { key: "behind", label: "Behind", tone: "peach" },
  { key: "awaiting", label: "Awaiting data", tone: "neutral" },
];

export function EvidenceSummary({ rangeLabel, summary, onCompile, loading, lastPacket }) {
  const total = summary?.total ?? 0;
  const onTrack = summary?.onTrack ?? 0;
  const pct = loading || total === 0 ? null : Math.round((onTrack / total) * 100);

  return (
    <Card className="flex flex-col gap-4">
      <div className="text-[15px] font-bold text-fg">Review packet</div>

      <Stat
        label={rangeLabel}
        value={pct == null ? "—" : `${pct}%`}
        unit={pct == null ? undefined : "on track"}
        sub={`${loading ? "—" : onTrack} of ${loading ? "—" : total} goals on track`}
        size="lg"
      />

      {total > 0 ? (
        <div className="flex gap-1">
          <span className="h-2 rounded-full bg-ink" style={{ flex: Math.max(onTrack, 0.001) }} />
          <span
            className="h-2 rounded-full bg-peach"
            style={{ flex: Math.max(total - onTrack, 0.001) }}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {ROWS.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted-fg">{r.label}</span>
            <Badge tone={r.tone}>{loading ? "—" : (summary?.[r.key] ?? 0)}</Badge>
          </div>
        ))}
      </div>

      {lastPacket?.submittedAt ? (
        <div className="flex items-center justify-between border-t border-line pt-3 text-[12.5px] text-muted-fg">
          <span>Last frozen packet</span>
          <span className="font-semibold text-fg">
            {new Date(lastPacket.submittedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      ) : null}

      <Button className="w-full" onClick={onCompile}>
        Compile into review
      </Button>
    </Card>
  );
}
