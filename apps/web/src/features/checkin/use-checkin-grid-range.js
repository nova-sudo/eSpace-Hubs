"use client";

/**
 * Week-range state for the catch-up grid view.
 *
 * URL params: `?from=W14&to=W19` (inclusive on both ends). When the
 * params are missing, we default to "the empty weeks behind us, capped
 * at the most-recent 12" — that's the cold-start case where the dev
 * just opened the grid for the first time and wants to fill in months
 * of backlog without manual range-picking.
 *
 * Returns:
 *   - `weeks`:        array of `{ start, end, weekLabel }` (newest-last)
 *   - `fromLabel`,
 *     `toLabel`:      current range boundaries
 *   - `setRange`:     write `from` + `to` back to the URL
 *   - `presetLastN`:  shortcut that targets the most-recent N completed
 *                     weeks (used by the toolbar's quick-presets)
 */

import { useCallback, useMemo } from "react";
import {
  useRouter,
  useSearchParams,
  usePathname,
} from "next/navigation";
import {
  DAY_MS,
  resolveCompletedWorkWeek,
  weekRangeFromLabel,
  weekLabel as weekLabelFn,
} from "@/lib/date";
import { readSnapshots } from "@/features/snapshots";

const MAX_GRID_WEEKS = 12;

export function useCheckinGridRange() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const fromParam = params?.get("from") || null;
  const toParam = params?.get("to") || null;

  // Default range = the empty weeks behind us, oldest first, capped
  // at MAX_GRID_WEEKS. Falls back to "the most-recent 6 weeks" when
  // no snapshots exist yet (first-time dev).
  const defaults = useMemo(() => computeDefaultRange(), []);
  const fromLabel = fromParam || defaults.fromLabel;
  const toLabel = toParam || defaults.toLabel;

  const weeks = useMemo(
    () => enumerateRange(fromLabel, toLabel),
    [fromLabel, toLabel],
  );

  const setRange = useCallback(
    (next) => {
      const sp = new URLSearchParams(window.location.search);
      if (next?.from) sp.set("from", next.from);
      if (next?.to) sp.set("to", next.to);
      router.replace(`${pathname}?${sp.toString()}`);
    },
    [router, pathname],
  );

  const presetLastN = useCallback(
    (n) => {
      const today = resolveCompletedWorkWeek();
      // Walk back N-1 weeks from today's Sunday to find the from-edge.
      const fromRange = weekFromOffset(today.start, -(n - 1) * 7);
      setRange({ from: fromRange.weekLabel, to: today.weekLabel });
    },
    [setRange],
  );

  return {
    weeks,
    fromLabel,
    toLabel,
    setRange,
    presetLastN,
    maxWeeks: MAX_GRID_WEEKS,
  };
}

/* ─────────── default-range derivation ─────────── */

function computeDefaultRange() {
  if (typeof window === "undefined") {
    // Server-render: pick something deterministic. The client will
    // re-derive once mounted.
    const today = resolveCompletedWorkWeek();
    return { fromLabel: today.weekLabel, toLabel: today.weekLabel };
  }

  const today = resolveCompletedWorkWeek();
  const filledWeeks = new Set(readSnapshots().map((s) => s.week));

  // Walk back from today's most-recent completed week toward Jan 1,
  // collecting EMPTY weeks until we hit MAX_GRID_WEEKS. If we exhaust
  // the year, the from-edge is Jan 1's week.
  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);

  let cursor = new Date(today.start);
  const empties = [];
  while (cursor >= yearStart && empties.length < MAX_GRID_WEEKS) {
    const midWeek = new Date(cursor.getTime() + 3 * DAY_MS);
    const label = weekLabelFn(midWeek);
    if (!filledWeeks.has(label)) empties.push(label);
    cursor = new Date(cursor.getTime() - 7 * DAY_MS);
  }

  if (empties.length === 0) {
    // No gaps! Show the last 6 weeks anyway so the page renders
    // something useful for the "I'm caught up but want to review"
    // scenario.
    const fromRange = weekFromOffset(today.start, -35);
    return { fromLabel: fromRange.weekLabel, toLabel: today.weekLabel };
  }

  // empties is newest-first; flip so fromLabel = oldest.
  return {
    fromLabel: empties[empties.length - 1],
    toLabel: empties[0],
  };
}

/* ─────────── range enumeration ─────────── */

function enumerateRange(fromLabel, toLabel) {
  const fromRange = weekRangeFromLabel(fromLabel);
  const toRange = weekRangeFromLabel(toLabel);
  if (!fromRange || !toRange) return [];

  const out = [];
  let cursor = new Date(fromRange.start);
  const stop = toRange.start.getTime();
  while (cursor.getTime() <= stop && out.length <= MAX_GRID_WEEKS) {
    const midWeek = new Date(cursor.getTime() + 3 * DAY_MS);
    const label = weekLabelFn(midWeek);
    const end = new Date(cursor);
    end.setDate(cursor.getDate() + 5); // Sun + 5 = Friday 00:00 (= Thu EOD)
    out.push({ start: new Date(cursor), end, weekLabel: label });
    cursor = new Date(cursor.getTime() + 7 * DAY_MS);
  }
  return out;
}

function weekFromOffset(anchorSunday, deltaDays) {
  const sunday = new Date(anchorSunday.getTime() + deltaDays * DAY_MS);
  sunday.setHours(0, 0, 0, 0);
  const friday = new Date(sunday);
  friday.setDate(sunday.getDate() + 5);
  return {
    start: sunday,
    end: friday,
    weekLabel: weekLabelFn(new Date(sunday.getTime() + 3 * DAY_MS)),
  };
}
