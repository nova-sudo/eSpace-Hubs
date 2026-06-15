"use client";

/**
 * One goal's health at a glance — the atomic unit of the Intelligence Hub.
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ COUNTER   Mentoring hours      ↑ [Over] ● On pace │
 *   │ ▓░▓▓  3 / 4 weeks                                  │
 *   │ last logged 2d ago                  Fill now →     │
 *   └──────────────────────────────────────────────────┘
 *
 * Receives a pre-derived `health` (+ `trend`) from useGoalHealth() and
 * renders. The only data access it does itself is the AI tier badge, which
 * is a self-contained shared-domain component (GoalTierBadge reads/grades
 * the cached daily verdict and self-hides when the goal has no tiers).
 *
 * Four signals stack right→left in priority: rule-based status pill (always),
 * AI tier verdict (when tiers exist), trend arrow (when a direction exists).
 */

import { useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/ui";
import { SPEC_KIND_META } from "@/features/goal-specs";
import { cadenceWindowLabel } from "@/features/goal-inputs";
import { GoalTierBadge } from "@/features/goal-tiers";
import { GoalManualEditor, isInlineFillable } from "@/features/goal-editors";
import { cn } from "@/lib/cn";
import { AutoGoalValue } from "./auto-value";
import { HEALTH, STATUS_META } from "./status";

function relAgo(ts) {
  if (!ts) return "—";
  const hr = (Date.now() - ts) / 3_600_000;
  if (hr < 1) return "just now";
  if (hr < 24) return `${Math.round(hr)}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function GoalHealthCard({ goal, spec, health, trend, fillHref, week }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[health.status] ?? STATUS_META[HEALTH.NO_DATA];
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const fill = health.fill;
  const cadence = spec?.manual?.cadence ?? null;

  // Can we fill this goal right here? Needs a fill, an inline-capable
  // editor for its widget kind, and a resolved week to write against.
  const canInline =
    health.needsFill && isInlineFillable(spec?.widget) && !!week;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-card px-3.5 py-3 transition-colors",
        health.needsFill ? "border-border-strong" : "border-border",
      )}
    >
      {/* Header: kind chip + title | trend · AI tier · status */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className="w-fit shrink-0 rounded-[3px] border border-border px-1 py-px text-[9px] uppercase tracking-[0.6px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {kindLabel}
          </span>
          <div className="truncate text-[13px] font-medium text-fg" title={goal?.title}>
            {goal?.title || spec?.title || "Untitled goal"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <TrendArrow trend={trend} />
          <GoalTierBadge goalId={goal?.id} spec={spec} />
          <Pill tone={meta.tone}>
            <span
              className="inline-block h-[6px] w-[6px] rounded-full"
              style={{ background: meta.dot }}
            />
            {meta.label}
          </Pill>
        </div>
      </div>

      {/* Body: live auto value (auto) or fill-rate strip (manual) */}
      {health.status === HEALTH.AUTO ? (
        <AutoGoalValue spec={spec} />
      ) : (
        <FillStrip fill={fill} cadence={cadence} />
      )}

      {/* Footer: last entry + CTA */}
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {/* Auto goals aren't hand-logged — no "last logged" line for them. */}
          {health.status === HEALTH.AUTO
            ? ""
            : fill?.lastEntryTs
              ? `last logged ${relAgo(fill.lastEntryTs)}`
              : "never logged"}
        </span>
        {!health.needsFill ? null : canInline ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] font-semibold text-accent hover:underline"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {open ? "Close" : "Fill now ▾"}
          </button>
        ) : fillHref ? (
          // Heavy editors (rubric / scorecard) live on the check-in page.
          <Link
            href={fillHref}
            className="text-[11px] font-semibold text-accent hover:underline"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Fill in check-in →
          </Link>
        ) : null}
      </div>

      {/* Inline editor — fill on the spot, scoped to the current work week.
          Writes hit goal-inputs immediately, so the card's status + fill
          strip update live (and the card may leave the focus view once
          it's no longer "needs attention"). */}
      {open && canInline ? (
        <div className="mt-1 border-t border-border pt-2.5">
          <GoalManualEditor
            widget={spec.widget}
            goal={goal}
            spec={spec}
            weekStart={week.start}
            weekEnd={week.end}
            activeLabel={week.weekLabel}
          />
          <div
            className="mt-2 text-[9px] uppercase tracking-[0.4px] text-muted-fg/60"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            logging to {week.weekLabel}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Direction-of-travel glyph. Coloured by GOODNESS (resolved against the
 * target op upstream), not raw direction — a falling turnaround time is
 * green, not red. Hidden when flat / not enough history.
 */
function TrendArrow({ trend }) {
  if (!trend || trend.dir === "flat") return null;
  const up = trend.dir === "up";
  const color =
    trend.good == null
      ? "var(--muted-fg)"
      : trend.good
        ? "var(--good)"
        : "#b91c1c";
  const title =
    trend.good == null
      ? `Trending ${trend.dir}`
      : trend.good
        ? "Improving vs last snapshot"
        : "Slipping vs last snapshot";
  return (
    <span
      className="text-[13px] font-bold leading-none"
      style={{ color }}
      title={title}
      aria-label={title}
    >
      {up ? "↑" : "↓"}
    </span>
  );
}

/**
 * "N of last M windows filled" bar — one dot per window, oldest→newest
 * (left→right), solid when that window had at least one entry. Shows the
 * actual fill PATTERN (gaps visible), not just a count. The unit noun is
 * cadence-aware so a monthly goal reads "/ 4 months", not "/ 4 weeks".
 */
function FillStrip({ fill, cadence }) {
  if (!fill) return null;
  const windows = Array.isArray(fill.windows)
    ? fill.windows
    : new Array(fill.recentWindows || 4).fill(false);
  const total = windows.length;
  const filled = windows.filter(Boolean).length;
  const noun = cadenceWindowLabel(cadence)[1]; // plural: weeks / months / …

  // windows[] is newest→oldest ([0] = current). Render oldest→newest so the
  // most-recent window sits on the right, nearest the label.
  const ordered = windows.slice().reverse();

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {ordered.map((solid, i) => (
          <span
            key={i}
            className={cn(
              "inline-block h-[7px] w-[7px] rounded-full",
              solid ? "bg-accent" : "bg-[rgba(0,0,0,0.10)]",
            )}
          />
        ))}
      </div>
      <span
        className="text-[10px] tabular-nums text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {filled} / {total} {noun}
      </span>
    </div>
  );
}
