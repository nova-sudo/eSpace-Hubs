"use client";

import { useMemo } from "react";
import { listLabelsFromMrs } from "../metrics/assisted";
import { useIntegrations } from "../use-integrations";
import { useCombinedMergedSince } from "./use-combined";
import { startOfYearIso } from "@/lib/date";

/**
 * Option list for the BYO label picker — "which labels could I track?"
 *
 * One source only: the labels seen on the user's YTD merged feed, which
 * every PR metric already fetches. That is deliberate. A repo's label
 * catalogue (`/repos/:r/labels`) lists everything anyone ever defined,
 * most of it never applied; the feed lists what actually lands on this
 * user's work, with a count that says how much signal a goal on it would
 * have. A label the picker doesn't know can still be typed — a team may
 * be about to start using one.
 *
 * Returns `{ options, isLoading, connected }`:
 *   options   — `[{ label, count }]`, most frequent first, lower-cased
 *   connected — a code host is connected (false → the picker falls back
 *               to free-text entry only)
 */
export function useLabelOptions() {
  const { isConnected } = useIntegrations();
  const connected = isConnected("github") || isConnected("gitlab");
  const merged = useCombinedMergedSince(connected ? startOfYearIso() : null);

  const options = useMemo(() => listLabelsFromMrs(merged.data || []), [merged.data]);

  return {
    options,
    isLoading: Boolean(merged.isLoading),
    connected,
  };
}
