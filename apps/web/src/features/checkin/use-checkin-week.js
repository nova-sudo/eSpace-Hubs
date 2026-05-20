"use client";

/**
 * Active-week state for the weekly check-in page.
 *
 * The active week lives in the URL (`?week=W19` or `?week=W19-2026`) so
 * deep links work and reloads preserve context. When the param is
 * missing we default to the most recent COMPLETED Sun → Thu work-week —
 * the same one the auto-snapshotter would have captured. Devs land on
 * "last week" by default because that's almost always the one with
 * blanks to fill.
 *
 * The hook also exposes `setWeekLabel` (writes back to the URL) plus
 * pre-resolved `range` / `prev` / `next` triples so navigators don't
 * have to know about the date math.
 */

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  resolveCompletedWorkWeek,
  weekRangeFromLabel,
  DAY_MS,
  weekLabel as weekLabelFn,
} from "@/lib/date";

export function useCheckinWeek() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The default landing week — most recent completed Sun → Thu. Stable
  // within a single render and across renders within the same calendar
  // day, so URL navigations stay deterministic.
  const defaultWeek = useMemo(() => resolveCompletedWorkWeek(), []);

  const requestedLabel = params?.get("week") || null;
  const activeLabel = (requestedLabel || defaultWeek.weekLabel).trim();

  const range = useMemo(() => {
    const r = weekRangeFromLabel(activeLabel);
    return r || defaultWeek;
  }, [activeLabel, defaultWeek]);

  // prev / next week labels, derived by stepping ±7 days from the
  // active range's start and re-computing the Wnn label. Cheap.
  const prevLabel = useMemo(
    () => labelFromOffset(range, -7),
    [range],
  );
  const nextLabel = useMemo(
    () => labelFromOffset(range, +7),
    [range],
  );

  // Today's "most recent completed" week — used by the Today button.
  const todayLabel = defaultWeek.weekLabel;

  // Don't let users navigate past `todayLabel` — the in-progress week
  // has no Thursday EOD yet, so its snapshot is meaningless. Clamp the
  // next-button when we're already at todayLabel.
  const canGoNext = activeLabel !== todayLabel;

  const setWeekLabel = useCallback(
    (label) => {
      if (!label) return;
      const params = new URLSearchParams(window.location.search);
      params.set("week", label);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname],
  );

  return {
    activeLabel,
    range,
    prevLabel,
    nextLabel,
    todayLabel,
    canGoNext,
    setWeekLabel,
  };
}

/* ───────── helpers ───────── */

function labelFromOffset(range, deltaDays) {
  const ms = range.start.getTime() + deltaDays * DAY_MS;
  const sunday = new Date(ms);
  // Mid-week date is what `weekLabel` keys on — Tuesday lands cleanly
  // inside the Sun → Thu window for both prev and next moves.
  const midWeek = new Date(sunday.getTime() + 3 * DAY_MS);
  return weekLabelFn(midWeek);
}
