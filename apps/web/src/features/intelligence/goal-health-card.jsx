"use client";

/**
 * One goal's health at a glance — the atomic unit of the Intelligence Hub.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ COUNTER   Mentoring hours          ● On pace  │
 *   │ ▓▓▓▓▓▓▓▓░░  3 / 4 wks                          │
 *   │ last logged 2d ago              Fill now →     │
 *   └──────────────────────────────────────────────┘
 *
 * Pure presentation: it receives a pre-derived `health` object from
 * useGoalHealth() and renders. No data access of its own. Status colour +
 * label come from STATUS_META so Sprint 2's AI verdict can re-skin the
 * chip by extending that one table.
 */

import Link from "next/link";
import { Pill } from "@/components/ui";
import { SPEC_KIND_META } from "@/features/goal-specs";
import { cn } from "@/lib/cn";
import { HEALTH, STATUS_META } from "./status";

function relAgo(ts) {
  if (!ts) return "—";
  const hr = (Date.now() - ts) / 3_600_000;
  if (hr < 1) return "just now";
  if (hr < 24) return `${Math.round(hr)}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function GoalHealthCard({ goal, spec, health, fillHref }) {
  const meta = STATUS_META[health.status] ?? STATUS_META[HEALTH.NO_DATA];
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const fill = health.fill;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border bg-card px-3.5 py-3 transition-colors",
        health.needsFill ? "border-border-strong" : "border-border",
      )}
    >
      {/* Header: kind chip + title + status pill */}
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
        <Pill tone={meta.tone}>
          <span
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{ background: meta.dot }}
          />
          {meta.label}
        </Pill>
      </div>

      {/* Body: fill-rate strip (manual) or auto note */}
      {health.status === HEALTH.AUTO ? (
        <div
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Computed from your activity · no manual entry needed
        </div>
      ) : (
        <FillStrip fill={fill} />
      )}

      {/* Footer: last entry + CTA */}
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {fill?.lastEntryTs ? `last logged ${relAgo(fill.lastEntryTs)}` : "never logged"}
        </span>
        {health.needsFill && fillHref ? (
          <Link
            href={fillHref}
            className="text-[11px] font-semibold text-accent hover:underline"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Fill now →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tiny "N of last M windows filled" bar — M dots, the most recent on the
 * right, filled when that window had an entry. Cheap, honest, no library.
 */
function FillStrip({ fill }) {
  if (!fill) return null;
  const total = fill.recentWindows || 4;
  const filled = Math.min(fill.filledRecent || 0, total);
  // Dots: oldest → newest, left → right. We only know the COUNT of filled
  // recent windows (not which), so render `filled` solid dots flushed
  // right (most-recent side) — a faithful "how many of the last M".
  const dots = [];
  for (let i = 0; i < total; i += 1) {
    const solid = i >= total - filled;
    dots.push(
      <span
        key={i}
        className={cn(
          "inline-block h-[7px] w-[7px] rounded-full",
          solid ? "bg-accent" : "bg-[rgba(0,0,0,0.10)]",
        )}
      />,
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">{dots}</div>
      <span
        className="text-[10px] tabular-nums text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {filled} / {total} wks
      </span>
    </div>
  );
}
