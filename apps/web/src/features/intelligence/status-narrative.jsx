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
    const why = worst.health.overdue
      ? "is overdue"
      : (WORST_REASON[worst.health.status] ?? "needs an update");
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
  const attentionMode = summary.attention > 0;

  // Big dot-matrix stat: how many need you, over total. Calm → all-on-pace.
  const statNum = attentionMode
    ? summary.attention
    : summary.onPace + summary.auto;
  const statStr = String(statNum).padStart(2, "0");
  const statLabel = attentionMode ? "Need your attention" : "All on pace";
  const statLabelColor = attentionMode ? "var(--bad)" : "var(--good)";

  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-tile)] border border-border"
      style={{
        backgroundColor: "var(--card)",
        // Nothing's signature halftone dot-grid, faded toward the right.
        backgroundImage: "radial-gradient(var(--dot-dim) 1px, transparent 1px)",
        backgroundSize: "9px 9px",
      }}
    >
      <div className="flex flex-col gap-5 px-6 py-5 sm:flex-row sm:items-center sm:gap-7">
        {/* Left — the dot-matrix stat block */}
        <div className="flex shrink-0 flex-col gap-2">
          <span
            className="uppercase tracking-[1.5px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            Where you stand
          </span>
          <div className="flex items-end gap-1" style={{ fontFamily: "var(--font-dot)", fontWeight: 900, lineHeight: 0.8 }}>
            <span style={{ fontSize: 52, color: "var(--accent)" }}>{statStr}</span>
            <span style={{ fontSize: 24, color: "var(--dim-fg)", paddingBottom: 2 }}>
              /{summary.total}
            </span>
          </div>
          <span
            className="uppercase tracking-[1.5px]"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: statLabelColor }}
          >
            {statLabel}
          </span>
        </div>

        {/* Dashed hairline divider — vertical on wide, horizontal on narrow */}
        <div
          aria-hidden="true"
          className="hidden self-stretch sm:block"
          style={{ borderLeft: "1px dashed var(--border-strong)" }}
        />
        <div
          aria-hidden="true"
          className="block h-0 w-full sm:hidden"
          style={{ borderTop: "1px dashed var(--border-strong)" }}
        />

        {/* Right — the narrative */}
        <div className="min-w-0 flex-1">
          <div
            className="font-semibold text-fg"
            style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.25, letterSpacing: "-0.3px" }}
          >
            {headline}
          </div>
          {detail ? (
            <div className="mt-1.5 text-[13px] leading-[1.5] text-muted-fg">{detail}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
