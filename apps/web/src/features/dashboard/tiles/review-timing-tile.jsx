"use client";

import Link from "next/link";
import { BentoTile, TileState } from "@/components/ui";
import {
  aggregateTiming,
  fmtMs,
  usePrReviewTimings,
} from "@/features/integrations";
import { useDateRange, splitByRange } from "../date-range";

/**
 * Review-timing tile — the section's main aggregate.
 *
 * Three big numbers across the top — TTFR median, ATTNR median, total Idle —
 * sit on top of a single illustrative timeline:
 *
 *   ●━━━━━━━ TTFR ━━━━━━━●━━━ ATTNR ━━━●  ——  IDLE
 *   Push           1st review     2nd review     total wait
 *
 * The bar widths are real (proportional to the median TTFR vs median ATTNR)
 * so the user can SEE which gap dominates their review cycle. Below sits a
 * ranked list of the worst-idle PRs in the window, identical-styled to the
 * Turnaround tile so the visual language is consistent.
 *
 * The "Open review log →" button takes the user to /reviews where every PR
 * is shown with its full comment thread + code snippets.
 */
export function ReviewTimingTile() {
  const { range } = useDateRange();
  const { data: timings, isLoading, error } = usePrReviewTimings(range.fetchSince);

  // Filter to the active date window. `splitByRange` returns previous-period
  // too — we only need current.
  const inWindow = splitByRange(timings || [], range, (t) =>
    t.pr?.mergedAt || t.pr?.createdAt,
  ).current;

  const onlyTimings = inWindow
    .map((t) => t.timing)
    .filter(Boolean);
  const agg = aggregateTiming(onlyTimings);

  const slowest = [...inWindow]
    .filter((t) => t.timing && t.timing.idle > 0)
    .sort((a, b) => (b.timing.idle || 0) - (a.timing.idle || 0))
    .slice(0, 5);
  const maxIdle = slowest[0]?.timing?.idle || 1;

  return (
    <BentoTile
      col="span 12"
      row="span 4"
      label={`Review timing · ${range.label.toLowerCase()} · ${agg.prsWithReview}/${agg.prCount} PRs reviewed`}
      title="How long does code wait for review?"
      titleSize={18}
      right={
        <Link
          href="/reviews"
          className="font-bold text-accent hover:underline"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          OPEN REVIEW LOG ↗
        </Link>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* Headline numbers + timeline */}
        <HeadlineRow agg={agg} loading={isLoading} error={error} />
        <Timeline agg={agg} />

        {/* Slowest PRs by total idle */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="mb-1.5 uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              color: "var(--muted-fg)",
            }}
          >
            Most idle PRs →
          </div>
          {slowest.length === 0 ? (
            <TileState
              kind={error ? "error" : "empty"}
              silhouette="list"
              message={
                isLoading
                  ? "Loading review timings…"
                  : error
                    ? "Couldn't load review data."
                    : "No reviewed PRs in this window."
              }
              sub={
                !isLoading && !error
                  ? "Reviews land here once a teammate comments on one of your merged PRs."
                  : undefined
              }
            />
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {slowest.map((it) => (
                <SlowestRow key={it.pr.id} it={it} maxIdle={maxIdle} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </BentoTile>
  );
}

function HeadlineRow({ agg, loading, error }) {
  return (
    <div className="grid grid-cols-3 gap-3.5">
      <BigStat
        label="TTFR median"
        sub="Push → first review"
        value={
          error ? "!" : loading ? "…" : agg.medianTtfr != null ? fmtMs(agg.medianTtfr) : "—"
        }
      />
      <BigStat
        label="ATTNR median"
        sub="between review rounds"
        value={
          error ? "!" : loading ? "…" : agg.medianAttnr != null ? fmtMs(agg.medianAttnr) : "—"
        }
      />
      <BigStat
        label="Total idle"
        sub={`Σ TTNthRs across ${agg.prsWithReview} PR${agg.prsWithReview === 1 ? "" : "s"}`}
        value={error ? "!" : loading ? "…" : fmtMs(agg.totalIdle)}
      />
    </div>
  );
}

function BigStat({ label, sub, value }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[var(--radius-sub)] border border-border bg-card-alt px-3.5 py-3"
    >
      <div
        className="uppercase tracking-[0.5px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
      >
        {label}
      </div>
      <div
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 32,
          letterSpacing: "-1.2px",
        }}
      >
        {value}
      </div>
      <div
        className="text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {sub}
      </div>
    </div>
  );
}

/**
 * Visual timeline: Push --TTFR-> Comment --ATTNR-> Comment.
 *
 * Bar widths are proportional to the median TTFR vs ATTNR so the user
 * sees at a glance which segment dominates. When data is missing we fall
 * back to equal halves so the diagram still renders meaningfully.
 */
function Timeline({ agg }) {
  const t = agg.medianTtfr || 0;
  const a = agg.medianAttnr || 0;
  const total = t + a;
  const tPct = total > 0 ? (t / total) * 100 : 50;
  const aPct = total > 0 ? (a / total) * 100 : 50;

  return (
    <div className="rounded-[var(--radius-sub)] border border-border bg-card-alt p-3.5">
      <div className="grid items-center" style={{ gridTemplateColumns: "auto 1fr auto 1fr auto" }}>
        <Marker label="Push" />
        <Segment label="TTFR" sublabel={fmtMs(agg.medianTtfr)} pct={tPct} />
        <Marker label="1st comment" />
        <Segment label="ATTNR" sublabel={fmtMs(agg.medianAttnr)} pct={aPct} variant="alt" />
        <Marker label="2nd comment" />
      </div>
      <div
        className="mt-2 text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        Idle = TTFR + Σ TTNthRs · the longer this bar, the more your work
        sits waiting on a reviewer.
      </div>
    </div>
  );
}

function Marker({ label }) {
  return (
    <div className="flex flex-col items-center gap-1 px-1">
      <div
        className="h-3 w-3 rounded-full border-2"
        style={{ borderColor: "var(--accent)", background: "var(--card)" }}
      />
      <div
        className="whitespace-nowrap uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
      >
        {label}
      </div>
    </div>
  );
}

function Segment({ label, sublabel, pct, variant = "primary" }) {
  // pct is informational — the segment lives in a 1fr cell so its visual
  // length is dictated by the grid, not pct. We surface pct as a label to
  // give users the relative-share signal.
  const fill = variant === "alt" ? "var(--accent-dim)" : "var(--accent)";
  const text = variant === "alt" ? "var(--accent)" : "#fff";
  return (
    <div className="px-1">
      <div
        className="relative flex h-7 items-center justify-center rounded-[3px]"
        style={{ background: fill }}
      >
        <span
          className="font-bold uppercase tracking-[0.5px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: text,
          }}
        >
          {label} · {sublabel}
        </span>
      </div>
      <div
        className="mt-1 text-center text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
      >
        {Math.round(pct)}% of cycle
      </div>
    </div>
  );
}

/**
 * One ranked row in the "Most idle PRs" list.
 * Bar = idle relative to the worst PR in the window.
 */
function SlowestRow({ it, maxIdle }) {
  const idle = it.timing?.idle || 0;
  const pct = (idle / maxIdle) * 100;
  const widthPct = idle <= 0 ? 0 : Math.max(2, pct);
  return (
    <li
      className="grid items-center gap-3"
      style={{ gridTemplateColumns: "70px 1fr 130px 70px" }}
      title={it.pr.title || ""}
    >
      <Link
        href={`/reviews?pr=${encodeURIComponent(it.pr.id)}`}
        className="truncate font-bold text-accent hover:underline"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
      >
        #{it.pr.number}
      </Link>
      <span className="truncate text-[12px]">{it.pr.title || "(no title)"}</span>
      <div
        className="h-[6px] overflow-hidden rounded-[3px]"
        style={{ background: "var(--border)" }}
      >
        <div
          className="h-full rounded-[3px]"
          style={{ width: `${widthPct}%`, background: "var(--accent)" }}
        />
      </div>
      <span
        className="text-right"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
      >
        {fmtMs(idle)}
      </span>
    </li>
  );
}
