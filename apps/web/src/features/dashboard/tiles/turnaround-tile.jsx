"use client";

import Link from "next/link";
import { BentoTile, Delta, TileState } from "@/components/ui";
import {
  getDashboardProviderDependency,
  fmtDurationHours,
  ProviderStateCallout,
  useCombinedMergedSince,
  useIntegrations,
} from "@/features/integrations";
import { useHubLink } from "@/features/hubs";
import { useDateRange, splitByRange } from "../date-range";

const TURNAROUND_DEPENDENCY = getDashboardProviderDependency("reviewTiming");
const CODE_HOSTS = TURNAROUND_DEPENDENCY.providers;

/**
 * Turnaround tile — time from PR open → merge.
 *
 * v3 design: ranked horizontal bars for the slowest PRs + a quartile
 * footer. Replaces both the old 5-bucket histogram (no shape, no names)
 * AND the v2 dot strip (clusters into "0h" and "48h+" stacks when the
 * distribution is bimodal — which it usually is for active repos:
 * most PRs merge fast, a handful drag for days).
 *
 *   ┌────────────────────────────┐
 *   │ TURNAROUND · OPEN → MERGE  │
 *   │ 0.3h            13 prs     │  ← big median, count
 *   │ median                     │
 *   │                            │
 *   │ Slowest →                  │
 *   │ #14  ███████████  3.2d     │  ← named outliers, bar = magnitude
 *   │ #11  ██           18h      │
 *   │ #3   █             4h      │
 *   │ #5                 2h      │
 *   │ #6                 1h      │
 *   │                            │
 *   │ P25 0.1h · P75 4h          │  ← spread summary
 *   └────────────────────────────┘
 *
 * The bars are scaled relative to the slowest PR in the window. So if
 * one PR took 3 days while the next-slowest took 18 hours, you see the
 * 4× gap visually — which is the actionable signal ("PR #14 sat in
 * review for an unusually long time, follow up").
 */
export function TurnaroundTile() {
  const { range } = useDateRange();
  const { isConnected } = useIntegrations();
  const link = useHubLink();
  const { data, isLoading, error } = useCombinedMergedSince(range.fetchSince);
  const { current, previous } = splitByRange(
    data || [],
    range,
    (m) => m.merged_at,
  );

  const stats = computeStats(current);
  const prevStats = computeStats(previous);
  const medianDelta =
    stats.median != null && prevStats.median != null
      ? stats.median - prevStats.median
      : null;
  const slowest = stats.bySlowest.slice(0, 5);
  const maxHours = stats.bySlowest[0]?.hours || 1;
  const hasCodeHost = CODE_HOSTS.some((id) => isConnected(id));

  if (!hasCodeHost) {
    return (
      <BentoTile col="span 3" row="span 1" usedInEvidence label="Turnaround · open → merge">
        <ProviderStateCallout
          kind="disconnected"
          providers={CODE_HOSTS}
          message="Connect GitLab or GitHub to see turnaround time for your merged PRs."
          actionHref={link("/settings")}
          actionLabel="Connect source"
        />
      </BentoTile>
    );
  }
  if (isLoading) {
    return (
      <BentoTile col="span 3" row="span 1" usedInEvidence label="Turnaround · open → merge">
        <TileState kind="loading" silhouette="stat" />
      </BentoTile>
    );
  }
  if (error) {
    return (
      <BentoTile col="span 3" row="span 1" usedInEvidence label="Turnaround · open → merge">
        <TileState kind="error" message="Couldn't load turnaround." />
      </BentoTile>
    );
  }

  return (
    <BentoTile col="span 3" row="span 1" label="Turnaround · open → merge">
      <div className="flex h-full flex-col">
        {/* Big stat row: median + count */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <div
              className="font-semibold leading-none"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 36,
                letterSpacing: "-1.4px",
              }}
            >
              {stats.median != null ? fmtDurationHours(stats.median) : "—"}
            </div>
            <div
              className="text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              median
            </div>
            {medianDelta != null ? (
              <Delta
                // Lower turnaround is better.
                invert
                value={`${medianDelta > 0 ? "+" : ""}${fmtDurationHours(medianDelta)}`}
              />
            ) : null}
          </div>
          <div
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            {stats.count} pr{stats.count === 1 ? "" : "s"}
          </div>
        </div>

        {/* Slowest-PR bars — the visual signal */}
        {slowest.length > 0 ? (
          <div className="mt-3 flex min-h-0 flex-1 flex-col">
            <div
              className="mb-1.5 uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                color: "var(--muted-fg)",
              }}
            >
              Slowest →
            </div>
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5">
              {slowest.map((it) => (
                <SlowestRow key={prKey(it.pr)} it={it} maxHours={maxHours} />
              ))}
            </ul>
          </div>
        ) : (
          <TileState
            kind="empty"
            message="No merged PRs in this window."
            sub="Try widening the date range."
            className="mt-3"
          />
        )}

        {/* Quartile footer — only render with enough data */}
        {stats.count >= 2 ? (
          <div
            className="mt-2 border-t border-border pt-2 text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            P25 {fmtDurationHours(stats.p25)} · P75{" "}
            {fmtDurationHours(stats.p75)}
          </div>
        ) : null}
      </div>
    </BentoTile>
  );
}

/* ─────────────────────────── one ranked row ─────────────────────────── */

function SlowestRow({ it, maxHours }) {
  const { pr, hours } = it;
  const pctRaw = (hours / maxHours) * 100;
  // Floor visible width so even quick PRs leave a sliver of accent;
  // visually communicates "yes there's data, it's just small".
  const widthPct = hours <= 0 ? 0 : Math.max(2, pctRaw);
  // Only link GitHub-source PRs — `/reviews` is GitHub-only today.
  const canLink = pr?.source === "github" && pr?.id;
  return (
    <li
      className="grid items-center gap-2"
      style={{ gridTemplateColumns: "38px 1fr 56px" }}
      title={pr.title || ""}
    >
      {canLink ? (
        <Link
          href={`/reviews?pr=${encodeURIComponent(pr.id)}`}
          className="truncate font-bold text-accent hover:underline"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          {prRef(pr)}
        </Link>
      ) : (
        <span
          className="truncate font-bold text-accent"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          {prRef(pr)}
        </span>
      )}
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
        className="text-right text-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
      >
        {fmtDurationHours(hours / 24)}
      </span>
    </li>
  );
}

/* ─────────────────────────── helpers ─────────────────────────── */

function computeStats(mrs) {
  const items = [];
  for (const m of mrs) {
    if (!m.merged_at || !m.created_at) continue;
    const hours =
      (new Date(m.merged_at) - new Date(m.created_at)) / 3_600_000;
    if (!Number.isFinite(hours) || hours < 0) continue;
    items.push({ pr: m, hours });
  }
  if (items.length === 0) {
    return {
      bySlowest: [],
      count: 0,
      median: null,
      p25: null,
      p75: null,
    };
  }
  // Two views over the same set: sorted ascending for percentile picks,
  // sorted descending for the slowest-N display.
  const asc = [...items].sort((a, b) => a.hours - b.hours);
  const desc = [...items].sort((a, b) => b.hours - a.hours);
  const at = (q) => {
    const idx = Math.min(asc.length - 1, Math.max(0, Math.floor(q * asc.length)));
    return asc[idx].hours;
  };
  return {
    bySlowest: desc,
    count: items.length,
    // metric layer expects days, so convert hours→days for the formatter
    median: at(0.5) / 24,
    p25: at(0.25) / 24,
    p75: at(0.75) / 24,
  };
}

function prRef(pr) {
  if (!pr) return "—";
  const n = pr.iid || pr.number;
  return n != null ? `#${n}` : "PR";
}

function prKey(pr) {
  return pr?.id || pr?.iid || pr?.number || Math.random();
}
