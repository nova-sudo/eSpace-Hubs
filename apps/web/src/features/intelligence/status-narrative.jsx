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
 * Not currently mounted by IntelligencePage (the Focus layout replaced it),
 * kept as the Sprint-2 "summarise with AI" integration seam.
 *
 * `ruleBasedNarrative()` stays exported as the fallback for any future
 * on-demand "summarise with AI" affordance.
 */

import { Card, Label } from "@/components/ui";

/**
 * Deterministic summary line(s) from the health model.
 *
 * @param {object} summary  useGoalHealth().summary
 * @param {Array}  queue    useGoalHealth().queue (severity-sorted; [0] worst)
 * @returns {{ headline: string, detail: string | null }}
 */
export function ruleBasedNarrative(summary, queue = []) {
  const { total, onPace, auto, attention, noData, behind } = summary;
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
    // The shared status's own words ("Behind · 2 weeks missed").
    const st = worst.status;
    const why = st ? [st.label, st.reason].filter(Boolean).join(" · ").toLowerCase() : "needs an update";
    detail = `Start with “${worst.goal.title}” — ${why}.`;
    const tail = [];
    if (noData > 0) tail.push(`${noData} not logged`);
    if (behind > 0) tail.push(`${behind} behind`);
    if (tail.length > 1) detail += ` In all: ${tail.join(", ")}.`;
  } else {
    const parts = [];
    if (noData > 0) parts.push(`${noData} not logged yet`);
    if (behind > 0) parts.push(`${behind} ${behind === 1 ? "is" : "are"} behind`);
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

  const statNum = attentionMode ? summary.attention : summary.onPace + summary.auto;
  const statLabel = attentionMode ? "Need your attention" : "All on pace";

  return (
    <Card padding={24} className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="flex shrink-0 flex-col gap-1.5">
        <Label>Where you stand</Label>
        <div className="flex items-end gap-1.5">
          <span className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
            {statNum}
          </span>
          <span className="pb-0.5 text-[18px] font-semibold text-muted-fg">/{summary.total}</span>
        </div>
        <Label>{statLabel}</Label>
      </div>

      <div className="min-w-0 flex-1 border-t border-line pt-4 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
        <div className="text-[18px] font-bold leading-[1.3] tracking-[-0.01em] text-fg">{headline}</div>
        {detail ? <div className="mt-1.5 text-[13px] leading-[1.5] text-muted-fg">{detail}</div> : null}
      </div>
    </Card>
  );
}
