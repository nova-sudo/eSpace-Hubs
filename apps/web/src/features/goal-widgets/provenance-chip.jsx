"use client";

/**
 * F5 — the data-honesty chip (#230).
 *
 * One line of mono microcopy under an AUTO widget saying what the number
 * is actually made of: sample size, the window genuinely covered, and how
 * long ago it was fetched — plus an explicit "partial" flag when a known
 * fetch/hydration cap was hit (Jira's 50-row sample, CI's last-100
 * builds, GitHub's 30-PR review-comment hydration). Numbers a user can
 * cite in a review without being wrong.
 *
 * The chip is also the app's refresh affordance: SWR keys are constant
 * all year (YTD anchors), so before this there was NO way to refetch
 * short of a full page reload. Clicking revalidates every integration
 * key at once (see refreshIntegrationData) — global on purpose, since
 * sibling tiles share the same underlying fetches.
 */

import { useState } from "react";
import { toast } from "sonner";
import { refreshIntegrationData } from "@/features/integrations";
import { fmtRelative } from "@/lib/fmt";

export function ProvenanceChip({ provenance, variant = "light" }) {
  const [busy, setBusy] = useState(false);
  if (!provenance) return null;

  const { sample, unit, window, fetchedAt, truncated, note, error } = provenance;
  const isLight = variant === "light";
  const dim = isLight ? "rgba(255,255,255,0.55)" : "var(--dim-fg)";
  const warn = isLight ? "rgba(255,214,140,0.95)" : "var(--warn)";

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

  const parts = [];
  if (error) {
    parts.push("data error");
  } else if (sample == null) {
    parts.push("fetching…");
  } else {
    parts.push(`n=${sample}${unit ? ` ${unit}` : ""}${truncated ? " (partial)" : ""}`);
  }
  if (window) parts.push(window);
  if (fetchedAt) parts.push(`${fmtRelative(new Date(fetchedAt).toISOString())} ago`);

  const tooltip = error
    ? "The upstream fetch failed — this tile may be stale or empty. Click to retry."
    : [note, "Click to refetch all integration data."].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      onClick={handleRefresh}
      title={tooltip}
      aria-label={`Data provenance: ${parts.join(", ")}. Refresh data.`}
      className="inline-flex max-w-full items-center gap-1 truncate uppercase transition-opacity hover:opacity-80"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.4px",
        color: error || truncated ? warn : dim,
        background: "transparent",
      }}
    >
      <span className="truncate">{parts.join(" · ")}</span>
      <span aria-hidden="true">{busy ? "…" : "⟳"}</span>
    </button>
  );
}
