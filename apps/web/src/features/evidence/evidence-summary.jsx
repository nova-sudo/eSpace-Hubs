"use client";

/**
 * Sidebar "Review packet" card: where the goals stand, in the SAME words and
 * the same number Home and Goals print — "Logged so far" (due windows only,
 * weighted by objective) and the shared status counts — plus the goals that
 * aren't in that number. The "Preview document" action switches tabs.
 */

import { Badge, Button, Card, Stat } from "@/components/ui";
import { unmeasuredLine } from "@/features/goal-inputs";

export function EvidenceSummary({ rangeLabel, summary, onCompile, loading, lastPacket }) {
  const pct = loading ? null : (summary?.pct ?? null);
  const logged = summary?.logged ?? { done: 0, due: 0 };
  const counts = summary?.counts ?? [];
  const unmeasured = loading ? null : unmeasuredLine(summary?.unmeasured ?? 0);

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="m-0 text-[15px] font-bold text-fg">Review packet</h2>

      <Stat
        label={`Logged so far · ${rangeLabel}`}
        value={pct == null ? "—" : `${pct}%`}
        sub={
          loading
            ? "—"
            : logged.due > 0
              ? `${logged.done} of ${logged.due} check-ins that were due`
              : "Nothing was due yet"
        }
        size="lg"
      />

      {pct != null ? (
        <div className="flex gap-1" aria-hidden="true">
          <span className="h-2 rounded-full bg-ink" style={{ flex: Math.max(pct, 0.001) }} />
          <span className="h-2 rounded-full bg-peach" style={{ flex: Math.max(100 - pct, 0.001) }} />
        </div>
      ) : null}

      {unmeasured ? <p className="m-0 text-[12.5px] leading-[1.5] text-muted-fg">{unmeasured}</p> : null}

      {counts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {counts.map((c) => (
            <div key={c.status} className="flex items-center justify-between gap-2" title={c.description}>
              <span className="text-[13px] text-muted-fg">{c.label}</span>
              <Badge tone={c.tone}>{loading ? "—" : c.count}</Badge>
            </div>
          ))}
        </div>
      ) : null}

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

      {/* Soft: it only switches to the Document tab. "Submit packet" is the
          page's one ink button. */}
      <Button className="w-full" variant="soft" onClick={onCompile}>
        Preview document
      </Button>
    </Card>
  );
}
