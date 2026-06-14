"use client";

/**
 * Zone 1 of the Intelligence Hub — the status narrative.
 *
 * SPRINT 1: this renders a deterministic, rule-based sentence built from
 * the health summary counts. No model call. It is the honest baseline.
 *
 * SPRINT 2: the AI narrative lands HERE — same slot, same props. The plan
 * is to call the `analyst` feature with the goal-health model and stream a
 * richer paragraph, falling back to `ruleBasedNarrative()` below whenever
 * the AI provider is unconfigured or errors. Keeping the rule-based text
 * as an exported pure function means that fallback is free.
 */

import { HEALTH } from "./status";

/**
 * Deterministic summary line(s) from the health summary counts.
 * Exported so Sprint 2 can use it as the AI fallback.
 *
 * @returns {{ headline: string, detail: string | null }}
 */
export function ruleBasedNarrative(summary) {
  const { total, onPace, auto, attention, noData, stale, behind } = summary;
  const healthy = onPace + auto;

  if (total === 0) {
    return {
      headline: "No goals are being tracked yet.",
      detail: "Add goals and classify them to start seeing your progress here.",
    };
  }

  if (attention === 0) {
    return {
      headline: `All ${total} tracked goals are on pace.`,
      detail:
        auto > 0
          ? `${auto} run automatically from your activity; the rest are filled and meeting target.`
          : "Everything's filled and meeting target — nothing needs you right now.",
    };
  }

  const headline =
    healthy > 0
      ? `${healthy} of ${total} goals are healthy — ${attention} need your attention.`
      : `${attention} of ${total} goals need your attention.`;

  // Lead the detail with the most urgent bucket.
  const parts = [];
  if (noData > 0) parts.push(`${noData} ${noData === 1 ? "has" : "have"} no data yet`);
  if (stale > 0) parts.push(`${stale} ${stale === 1 ? "has" : "have"} gone quiet`);
  if (behind > 0) parts.push(`${behind} ${behind === 1 ? "is" : "are"} behind target`);
  const detail = parts.length ? `${capitalize(parts.join(", "))}.` : null;

  return { headline, detail };
}

function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * The rendered narrative block. `summary` is useGoalHealth().summary.
 */
export function StatusNarrative({ summary }) {
  const { headline, detail } = ruleBasedNarrative(summary);
  const tone = summary.attention > 0 ? "attention" : "calm";

  return (
    <div
      className="rounded-lg border border-border bg-card px-6 py-5"
      style={{
        // Subtle accent wash when something needs the user; flat when calm.
        background:
          tone === "attention"
            ? "linear-gradient(180deg, var(--accent-dim) 0%, var(--card) 60%)"
            : undefined,
      }}
    >
      <div
        className="text-[10px] uppercase tracking-[0.6px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {/* Sprint 2 swaps this label to "AI summary" when the model drives it. */}
        Where you stand
      </div>
      <div
        className="mt-1.5 font-semibold text-fg"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          lineHeight: 1.2,
          letterSpacing: "-0.4px",
        }}
      >
        {headline}
      </div>
      {detail ? (
        <div className="mt-1 text-[13px] text-muted-fg">{detail}</div>
      ) : null}
    </div>
  );
}
