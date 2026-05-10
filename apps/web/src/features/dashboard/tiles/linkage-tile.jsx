"use client";

import { BentoTile, Delta, TileState } from "@/components/ui";
import {
  compareNumber,
  linkagePct,
  useCombinedMergedSince,
} from "@/features/integrations";
import { useDateRange, splitByRange } from "../date-range";

/**
 * Jira ↔ MR linkage — "what % of merged MRs reference a Jira ticket key".
 *
 * Design (section 01, col span 3 × row span 2):
 *   ┌──────────────────────────┐
 *   │ JIRA LINKAGE             │
 *   │ 92 %         +4pt (good) │ (56px stat, "%" suffix, green delta vs prev)
 *   │ MRs referencing a ticket │
 *   │ This wk 92% ▓▓▓▓▓▓▓      │ (two bar rows — accent / accent-2)
 *   │ Target 80%  ▓▓▓▓▓░░      │
 *   │ ┌ linked ┐ ┌ orphans ┐  │ (2-col micro-stat grid)
 *   │ │   47   │ │    4    │  │
 *   │ └────────┘ └─────────┘  │
 *   └──────────────────────────┘
 */

const TARGET_PCT = 80;

export function LinkageTile() {
  const { range } = useDateRange();
  const { data, isLoading, error } = useCombinedMergedSince(range.fetchSince);
  const { current, previous } = splitByRange(
    data || [],
    range,
    (m) => m.merged_at,
  );
  const cur = linkagePct(current);
  const prv = linkagePct(previous);
  const cmp = compareNumber(cur?.pct, prv?.pct);

  const curPct = cur?.pct ?? 0;

  return (
    <BentoTile
      col="span 3"
      row="span 2"
      label={`Jira linkage · ${range.label.toLowerCase()}`}
    >
      {isLoading ? (
        <TileState kind="loading" silhouette="stat" />
      ) : error ? (
        <TileState kind="error" message="Couldn't load linkage." />
      ) : !cur ? (
        <TileState
          kind="empty"
          message="No merged MRs in this window."
          sub="Connect GitHub or GitLab in Settings to populate."
        />
      ) : (
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
            {cur?.pct ?? "—"}
          </div>
          <div
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 20 }}
          >
            %
          </div>
          {cmp.delta != null ? (
            <Delta
              value={`${cmp.delta > 0 ? "+" : ""}${Math.round(cmp.delta)}pt`}
            />
          ) : null}
        </div>
        <div
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          MRs referencing a Jira key · vs last {range.label.toLowerCase()}
        </div>

        <div className="flex flex-col gap-1.5">
          <BarRow
            label="This wk"
            value={`${Math.round(curPct)}%`}
            fillPct={Math.min(100, curPct)}
            color="var(--accent)"
          />
          <BarRow
            label="Target"
            value={`${TARGET_PCT}%`}
            fillPct={TARGET_PCT}
            color="var(--accent-2)"
          />
        </div>

        <div className="mt-0.5 grid grid-cols-2 gap-1.5">
          <MicroStat k="Linked MRs" v={cur?.linked ?? 0} />
          <MicroStat k="Orphans" v={cur?.loose ?? 0} />
        </div>
      </div>
      )}
    </BentoTile>
  );
}

function BarRow({ label, value, fillPct, color }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="w-14 shrink-0 text-muted-fg"
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
        className="w-9 shrink-0 text-right font-semibold"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {value}
      </span>
    </div>
  );
}

function MicroStat({ k, v }) {
  return (
    <div
      className="rounded-[var(--radius-sub)] border border-border bg-card-alt px-2 py-1.5"
    >
      <div
        className="uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
      >
        {k}
      </div>
      <div
        className="font-semibold leading-[1.1]"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          letterSpacing: "-0.5px",
        }}
      >
        {v}
      </div>
    </div>
  );
}
