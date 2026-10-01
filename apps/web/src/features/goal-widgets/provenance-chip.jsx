"use client";

/**
 * F5 — the data-honesty chip (#230).
 *
 * One small badge under an AUTO widget saying what the number is actually
 * made of: sample size, the window genuinely covered, and how long ago it
 * was fetched — plus an explicit "partial" flag when a known fetch/
 * hydration cap was hit (Jira's 50-row sample, CI's last-100 builds,
 * GitHub's 30-PR review-comment hydration). Numbers a user can cite in a
 * review without being wrong.
 *
 * The chip is also the app's refresh affordance: SWR keys are constant
 * all year (YTD anchors), so before this there was NO way to refetch
 * short of a full page reload. Clicking revalidates every integration
 * key at once (see refreshIntegrationData) — global on purpose, since
 * sibling tiles share the same underlying fetches.
 */

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Badge, absoluteTime, clockTime, relativeAgo } from "@/components/ui";
import { refreshIntegrationData, useProviderActivity } from "@/features/integrations";
import { providersForSource } from "./use-source-live-status";

/**
 * Same words as <LiveValue> for the same situation: "updating…" while a
 * refresh runs, "rate limited until 11:05" / "last refresh failed" when the
 * number on screen is last-known, "updated 5 min ago" otherwise.
 */
export function ProvenanceChip({ provenance, source }) {
  const [busy, setBusy] = useState(false);
  const activity = useProviderActivity(providersForSource(source));
  if (!provenance) return null;

  const { sample, unit, window, fetchedAt, truncated, note, error } = provenance;

  async function handleRefresh() {
    if (busy) return;
    setBusy(true);
    try {
      await refreshIntegrationData();
      toast.success("Data refreshed.");
    } catch (err) {
      toast.error(`Refresh failed: ${err?.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  const limitedUntil = provenance.error && activity.rateLimitedUntil ? activity.rateLimitedUntil : null;
  const parts = [];
  if (sample == null) {
    parts.push(error ? (limitedUntil ? "rate limited" : "no data") : "loading");
  } else {
    parts.push(`n=${sample}${unit ? ` ${unit}` : ""}${truncated ? " (partial)" : ""}`);
  }
  if (window) parts.push(window);
  if (activity.isRefreshing && sample != null) parts.push("updating…");
  else if (limitedUntil) parts.push(`rate limited until ${clockTime(limitedUntil)}`);
  else if (error) parts.push("last refresh failed");
  else if (fetchedAt) parts.push(`updated ${relativeAgo(fetchedAt)}`);

  const tooltip = [
    fetchedAt ? `Fetched ${absoluteTime(fetchedAt)}.` : null,
    error
      ? "The last refresh failed — the number shown is the last one fetched. Click to retry."
      : null,
    note,
    error ? null : "Click to refetch all integration data.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={handleRefresh}
      title={tooltip}
      aria-label={`Data provenance: ${parts.join(", ")}. Refresh data.`}
      className="inline-flex max-w-full"
    >
      <Badge tone={error || truncated ? "lemon" : "sky"} className="max-w-full">
        <span className="truncate">{parts.join(" · ")}</span>
        <RefreshCw size={11} className={busy ? "motion-safe:animate-spin" : undefined} />
      </Badge>
    </button>
  );
}
