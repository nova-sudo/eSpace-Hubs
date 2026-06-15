"use client";

/**
 * Zone 1 of the Intelligence Hub — the status narrative.
 *
 * The intelligence here is AI-INFORMED but deterministic: it weaves in the
 * snapshot trend (improving/slipping) and names the single most urgent goal
 * by name, rather than firing a per-load LLM completion (which would be slow
 * and burn tokens on every page view). The genuinely-AI signal — the
 * achievement-tier verdict — lives per-card via GoalTierBadge, where it's
 * honest about which goals have actually been graded.
 *
 * `ruleBasedNarrative()` stays exported as the fallback for any future
 * on-demand "summarise with AI" affordance.
 */

import { HEALTH } from "./status";

const WORST_REASON = {
  [HEALTH.NO_DATA]: "has no data yet",
  [HEALTH.STALE]: "has gone quiet",
  [HEALTH.BEHIND]: "is behind target",
};

/**
 * Deterministic summary line(s) from the health model.
 *
 * @param {object} summary  useGoalHealth().summary
 * @param {Array}  queue    useGoalHealth().queue (severity-sorted; [0] worst)
 * @returns {{ headline: string, detail: string | null }}
 */
export function ruleBasedNarrative(summary, queue = []) {
  const { total, onPace, auto, attention, noData, stale, behind, slipping } =
    summary;
  const healthy = onPace + auto;

  if (total === 0) {
    return {
      headline: "No goals are being tracked yet.",
      detail: "Add goals and classify them to start seeing your progress here.",
    };
  }

  if (attention === 0) {
    const base =
      auto > 0
        ? `${auto} run automatically from your activity; the rest are filled and meeting target.`
        : "Everything's filled and meeting target — nothing needs you right now.";
    return {
      headline: `All ${total} tracked goals are on pace.`,
      detail: base + trendTail(summary),
    };
  }

  const headline =
    healthy > 0
      ? `${healthy} of ${total} goals are healthy — ${attention} need your attention.`
      : `${attention} of ${total} goals need your attention.`;

  // Lead with the single most urgent goal BY NAME — concrete beats counts.
  const worst = queue[0];
  let detail;
  if (worst) {
    const why = WORST_REASON[worst.health.status] ?? "needs an update";
    detail = `Start with “${worst.goal.title}” — it ${why}.`;
    const tail = [];
    if (noData > 0) tail.push(`${noData} with no data`);
    if (stale > 0) tail.push(`${stale} gone quiet`);
    if (behind > 0) tail.push(`${behind} behind target`);
    if (tail.length > 1) detail += ` In all: ${tail.join(", ")}.`;
  } else {
    const parts = [];
    if (noData > 0) parts.push(`${noData} ${noData === 1 ? "has" : "have"} no data yet`);
    if (stale > 0) parts.push(`${stale} ${stale === 1 ? "has" : "have"} gone quiet`);
    if (behind > 0) parts.push(`${behind} ${behind === 1 ? "is" : "are"} behind target`);
    detail = parts.length ? `${capitalize(parts.join(", "))}.` : null;
  }

  return { headline, detail: (detail || "") + trendTail(summary) || null };
}

/** Trailing trend clause — only when something is moving. */
function trendTail(summary) {
  const { improving = 0, slipping = 0 } = summary;
  if (slipping > 0) {
    return ` ${slipping} ${slipping === 1 ? "goal is" : "goals are"} slipping vs the last snapshot.`;
  }
  if (improving > 0) {
    return ` ${improving} ${improving === 1 ? "goal is" : "goals are"} trending up.`;
  }
  return "";
}

function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * The rendered narrative block. `summary` + `queue` come from useGoalHealth().
 */
export function StatusNarrative({ summary, queue }) {
  const { headline, detail } = ruleBasedNarrative(summary, queue);
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
