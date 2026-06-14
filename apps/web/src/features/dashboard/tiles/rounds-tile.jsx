"use client";

import { BentoTile, Delta, TileState } from "@/components/ui";
import {
  avgReviewerComments,
  compareNumber,
  useCombinedMergedSince,
} from "@/features/integrations";
import { fmtNumber } from "@/lib/fmt";
import { useDateRange, splitByRange } from "../date-range";

/**
 * Review rounds — the proxy is "average reviewer comments per merged MR".
 * Lower is tighter.
 *
 * Design (section 01, col span 2 × row span 2):
 *   ┌─────────────────┐
 *   │ REVIEW ROUNDS   │
 *   │ 1.8 avg         │ (56px display, "avg" suffix muted)
 *   │ Lower is tighter│
 *   │ You 1.8  ▓▓▓░  │ (single bar showing your average)
 *   │ 8-week trend   │
 *   │ ▁▂▃▁▂▃▁█       │ (accent-dim bars, last bar accent)
 *   └─────────────────┘
 *
 * The previous version showed a "Team p50" comparison bar driven by a
 * hardcoded constant. Removed — there's no real team aggregator behind
 * it, and a constant masquerading as data is misleading on a performance
 * dashboard. If we add a real team API later, restore the bar from that
 * source rather than reintroducing the constant.
 */

export function RoundsTile() {
  const { range } = useDateRange();
  const { data, isLoading, error } = useCombinedMergedSince(range.fetchSince);
  const { current, previous } = splitByRange(
    data || [],
    range,
    (m) => m.merged_at,
  );
  const yours = avgReviewerComments(current);
  const prev = avgReviewerComments(previous);
  const cmp = compareNumber(yours, prev);

  // 8-week bars from the fetched merged MRs, counting avg rounds per week.
  const weekly = weeklyAvgRounds(data || [], 8);

  // Bar fill is a relative gauge: 0 → max(your avg, 2.5) so a low value
  // doesn't look like a full bar (2.5 is the "high but plausible" ceiling
  // for review-rounds; tweakable if real data shifts).
  const ceiling = Math.max(yours || 0, 2.5);
  const fillYou = yours != null ? Math.min(100, (yours / ceiling) * 100) : 0;

  if (isLoading) {
    return (
      <BentoTile col="span 2" row="span 2" usedInEvidence label="Review rounds">
        <TileState kind="loading" silhouette="stat" />
      </BentoTile>
    );
  }
  if (error) {
    return (
      <BentoTile col="span 2" row="span 2" usedInEvidence label="Review rounds">
        <TileState kind="error" message="Couldn't load rounds." />
      </BentoTile>
    );
  }

  return (
    <BentoTile col="span 2" row="span 2" label="Review rounds">
      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-baseline gap-1.5">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 56,
              letterSpacing: "-1.8px",
            }}
          >
            {fmtNumber(yours ?? 0, 1)}
          </div>
          <div
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
          >
            avg
          </div>
          {cmp.delta != null ? (
            <Delta
              // Lower is better for review rounds.
              invert
              value={`${cmp.delta > 0 ? "+" : ""}${fmtNumber(cmp.delta, 1)}`}
            />
          ) : null}
        </div>
        <div
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          Lower is tighter
        </div>

        <div className="mt-1 flex flex-col gap-1.5">
          <BarRow
            label="You"
            value={yours != null ? fmtNumber(yours, 1) : "—"}
            fillPct={fillYou}
            color="var(--accent)"
          />
        </div>

        <WeeklyBars data={weekly} />
      </div>
    </BentoTile>
  );
}

function BarRow({ label, value, fillPct, color }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-8 shrink-0 text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {label}
      </span>
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${fillPct}%`, background: color }}
        />
      </div>
      <span
        className="w-7 shrink-0 text-right font-semibold"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {value}
      </span>
    </div>
  );
}

function WeeklyBars({ data }) {
  const max = Math.max(...data, 1);
  const lastIdx = data.length - 1;
  return (
    <div className="mt-1.5 flex items-end gap-[3px]" style={{ height: 28 }}>
      {data.map((v, i) => {
        const isLast = i === lastIdx;
        const h = Math.max(2, (v / max) * 26);
        return (
          <span
            key={i}
            className="flex-1 rounded-t-[2px]"
            style={{
              height: h,
              background: isLast ? "var(--accent)" : "var(--accent-dim)",
            }}
          />
        );
      })}
    </div>
  );
}

// Compute an 8-bucket trailing weekly average (comments per merged MR).
// Weeks are Sun-start to match the team's Sun → Thu work week.
function weeklyAvgRounds(mrs, weeks = 8) {
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  // Anchor at start of current Sun-week so buckets align with the calendar.
  const anchor = new Date(now);
  anchor.setDate(anchor.getDate() - anchor.getDay());
  anchor.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: weeks }, () => ({ sum: 0, n: 0 }));
  for (const mr of mrs) {
    if (!mr.merged_at) continue;
    const t = new Date(mr.merged_at).getTime();
    const weeksAgo = Math.floor((anchor.getTime() - t) / WEEK_MS);
    const idx = weeks - 1 - weeksAgo;
    if (idx < 0 || idx >= weeks) continue;
    buckets[idx].sum += mr.user_notes_count || 0;
    buckets[idx].n += 1;
  }
  return buckets.map((b) => (b.n > 0 ? b.sum / b.n : 0));
}
