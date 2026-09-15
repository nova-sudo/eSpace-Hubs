"use client";

/**
 * Presentation atoms shared by the manager portal's surfaces. Nothing in
 * here fetches or mutates — they exist so the team table, the person
 * rail, a report's board and the grading drawer all render the SAME
 * tier spread, the same empty card and the same status wording.
 *
 * The tier spread is the point of the file: `summary.byTier` is a
 * histogram the API has always returned and the UI used to throw away,
 * and a lead's first question about a person is its shape, not its sum.
 */

import { Badge, Label } from "@/components/ui";
import { TIER_LABELS } from "@/features/goal-tiers";
import { cn } from "@/lib/cn";
import { percent } from "./manager-format";

/** Tier → tint. One mapping for the whole hub. */
export const TIER_TONE = {
  not_achieved: "peach",
  achieved: "mint",
  over_achieved: "sky",
  role_model: "lav",
};

// Best rung first, so the bar reads left-to-right as "how much of this
// is good news".
const SPREAD_ORDER = ["role_model", "over_achieved", "achieved", "not_achieved"];

const SPREAD_FILL = {
  role_model: "bg-lav-ink",
  over_achieved: "bg-sky-ink",
  achieved: "bg-mint-ink",
  not_achieved: "bg-peach-ink",
};

/** Short spread wording — "2 over", not "2 over achieved". */
const SPREAD_SHORT = {
  role_model: "role model",
  over_achieved: "over",
  achieved: "achieved",
  not_achieved: "not achieved",
};

export function tierTotal(byTier) {
  if (!byTier) return 0;
  return SPREAD_ORDER.reduce((sum, t) => sum + (byTier[t] || 0), 0);
}

/**
 * The tier histogram as one stacked bar. Rungs with a zero count are
 * omitted rather than drawn at 0% so the bar never carries hairlines
 * that mean nothing.
 */
export function TierSpreadBar({ byTier, height = 8, className }) {
  const total = tierTotal(byTier);
  return (
    <span
      className={cn(
        "flex w-full overflow-hidden rounded-[var(--radius-pill)] bg-card-alt",
        className,
      )}
      style={{ height }}
      role="img"
      aria-label={
        total
          ? SPREAD_ORDER.filter((t) => byTier?.[t])
              .map((t) => `${byTier[t]} ${TIER_LABELS[t].toLowerCase()}`)
              .join(", ")
          : "Nothing graded yet"
      }
    >
      {SPREAD_ORDER.map((t) => {
        const n = byTier?.[t] || 0;
        if (!n || !total) return null;
        return (
          <span
            key={t}
            title={`${TIER_LABELS[t]}: ${n}`}
            className={SPREAD_FILL[t]}
            style={{ width: `${(n / total) * 100}%` }}
          />
        );
      })}
    </span>
  );
}

/**
 * The same histogram spelled out as badges, plus the ungraded remainder
 * — the count a spread bar can't show because it isn't a rung.
 */
export function TierSpreadLegend({ byTier, total, className }) {
  const graded = tierTotal(byTier);
  const ungraded = Math.max(0, (total ?? graded) - graded);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {SPREAD_ORDER.filter((t) => byTier?.[t]).map((t) => (
        <Badge key={t} tone={TIER_TONE[t]}>
          {byTier[t]} {SPREAD_SHORT[t]}
        </Badge>
      ))}
      {ungraded > 0 ? <Badge>{ungraded} ungraded</Badge> : null}
      {graded === 0 && ungraded === 0 ? <Badge>No goals yet</Badge> : null}
    </div>
  );
}

/** One line of spread copy for a tight footer — "1 not achieved · 6 achieved". */
export function spreadSentence(byTier, total) {
  const graded = tierTotal(byTier);
  const parts = SPREAD_ORDER.filter((t) => byTier?.[t]).map(
    (t) => `${byTier[t]} ${SPREAD_SHORT[t]}`,
  );
  const ungraded = Math.max(0, (total ?? graded) - graded);
  if (ungraded > 0) parts.push(`${ungraded} ungraded`);
  return parts.join(" · ");
}

/** The achievement tier as a badge, or an explicit "Ungraded". */
export function TierBadge({ tier, fallback = "Ungraded" }) {
  if (!tier) return <Badge>{fallback}</Badge>;
  return <Badge tone={TIER_TONE[tier] ?? "neutral"}>{TIER_LABELS[tier] ?? tier}</Badge>;
}

/** A plain ink-filled ratio bar — graded/total, windows logged, and friends. */
export function MiniBar({ value, total, height = 4, className }) {
  return (
    <span
      className={cn(
        "block w-full overflow-hidden rounded-[var(--radius-pill)] bg-card-alt",
        className,
      )}
      style={{ height }}
    >
      <span
        className="block h-full rounded-[var(--radius-pill)] bg-ink"
        style={{ width: `${percent(value, total)}%` }}
      />
    </span>
  );
}

/** Label + numeral in an inset panel — the rail's counts. */
export function CountTile({ label, value, tone = "alt" }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] p-3.5",
        tone === "alt" ? "bg-card-alt" : "bg-card",
      )}
    >
      <Label>{label}</Label>
      <div className="mt-1 text-[22px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
        {value}
      </div>
    </div>
  );
}

/** The hub's one empty / error / loading card. */
export function EmptyCard({ children, className }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-xl)] bg-card p-6 text-[13px] leading-[1.6] text-muted-fg",
        className,
      )}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {children}
    </div>
  );
}
