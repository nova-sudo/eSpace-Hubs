"use client";

/**
 * "Since last visit" — a compact horizontal strip on the Overview that
 * tells the user what's changed since they last opened the dashboard.
 *
 * Shows ONE sentence and 2–3 delta chips. Renders nothing on first visit
 * (no `previous` timestamp), so it stays out of the way for new users.
 *
 * Data sources:
 *   - merged-PR list — count merges between `previous` and now
 *   - events list   — count reviews given between `previous` and now
 *   - PR review timing (cached) — pick up TTFR direction
 *
 * Time window:
 *   "Since X" — where X is the previous-recorded last-seen timestamp.
 *   For an idle user who hasn't opened the app in months, this could be a
 *   long window. We cap fetch to 90 days (matches existing dashboard
 *   behaviour) and label accordingly.
 */

import { useEffect, useMemo } from "react";
import { Delta } from "@/components/ui";
import {
  countMrComments,
  useCombinedEventsSince,
  useCombinedMergedSince,
} from "@/features/integrations";
import { isoDaysAgo } from "@/lib/date";
import { bumpLastSeen, readLastSeen, LAST_SEEN_SETTLE_MS } from "../last-seen-store";

export function SinceLastVisitTile() {
  // Read once on mount — we deliberately don't subscribe to the store so the
  // tile renders the diff against what was last recorded BEFORE this visit's
  // bump. Subscribing would re-render with the post-bump value (zero diff).
  const { previous } = useMemo(() => readLastSeen(), []);

  // Side effect: record this visit. After SETTLE_MS the recorded timestamp
  // catches up to "now" — so the next session gets a fresh diff window.
  useEffect(() => {
    const id = setTimeout(() => bumpLastSeen(), LAST_SEEN_SETTLE_MS + 100);
    return () => clearTimeout(id);
  }, []);

  // 90d guard — the events API caps there anyway.
  const since = previous || isoDaysAgo(90);
  const { data: merged } = useCombinedMergedSince(since);
  const { data: events } = useCombinedEventsSince(since);

  // Hide on first visit OR if the gap was less than 12h (probably the same
  // working session).
  if (!previous) return null;
  const sincePrev = Date.now() - new Date(previous).getTime();
  if (sincePrev < 12 * 3_600_000) return null;

  const sinceLabel = humanGap(sincePrev);
  const newMerged = (merged || []).filter(
    (m) => m.merged_at && m.merged_at > previous,
  ).length;
  const newReviews = countMrComments(
    (events || []).filter((e) => e.created_at && e.created_at > previous),
  );
  const newComments = (events || []).filter(
    (e) => e.created_at && e.created_at > previous && e.action_name?.includes("commented"),
  ).length;

  return (
    <div
      className="-mx-2 mb-1 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sub)] border border-border bg-card-alt px-3 py-2"
      role="status"
      aria-label={`Since you were last here ${sinceLabel} ago`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
        >
          Since last visit
        </span>
        <span
          className="text-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {sinceLabel} ago
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="Merged" value={newMerged} positiveAbove={0} />
        <Chip label="Reviews given" value={newReviews} positiveAbove={0} />
        <Chip label="New comments" value={newComments} positiveAbove={0} />
      </div>
    </div>
  );
}

function Chip({ label, value }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className="uppercase tracking-[0.5px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
      >
        {label}
      </span>
      <Delta value={value > 0 ? `+${value}` : `${value}`} />
    </div>
  );
}

function humanGap(ms) {
  const hrs = ms / 3_600_000;
  if (hrs < 24) return `${Math.max(1, Math.round(hrs))}h`;
  const days = hrs / 24;
  if (days < 14) return `${Math.round(days)}d`;
  const weeks = days / 7;
  if (weeks < 8) return `${Math.round(weeks)}w`;
  const months = days / 30.4;
  return `${months < 12 ? Math.round(months) : Math.round(months)}mo`;
}
