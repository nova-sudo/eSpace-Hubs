"use client";

/**
 * One goal's health at a glance — the atomic unit of the Intelligence Hub's
 * full board.
 *
 * Receives a pre-derived `health` (+ `trend`) from useGoalHealth() and
 * renders. The only data access it does itself is the AI tier badge, which
 * is a self-contained shared-domain component (GoalTierBadge reads/grades
 * the cached daily verdict and self-hides when the goal has no tiers).
 *
 * Four signals stack in the header: kind · cadence label (always), AI tier
 * verdict (when tiers exist), trend badge (when a direction exists), and the
 * rule-based status badge (always, right-aligned).
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge, Card, FillStrip, Label } from "@/components/ui";
import { SPEC_KIND_META, specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel } from "@/features/goal-inputs";
import { GoalTierBadge } from "@/features/goal-tiers";
import { GoalManualEditor, isInlineFillable } from "@/features/goal-editors";
import {
  currentWindowKey,
  reopenCurrentWindow,
} from "@/features/goal-locks";
import { skipWindow } from "./skip-window";
import { GOAL_READINESS, readinessLabel } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import { AutoGoalValue } from "./auto-value";
import { HEALTH, statusDisplay } from "./status";

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function relAgo(ts) {
  if (!ts) return "—";
  const hr = (Date.now() - ts) / 3_600_000;
  if (hr < 1) return "just now";
  if (hr < 24) return `${Math.round(hr)}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function GoalHealthCard({ goal, spec, health, trend, fillHref, week }) {
  const [open, setOpen] = useState(false);
  const hubLink = useHubLink();
  const meta = statusDisplay(health);
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const fill = health.fill;
  // manual.cadence OR composed.cadence — must match what deriveGoalHealth
  // bucketed on, so the strip label and lock key agree with the status.
  const cadence = specCadence(spec);
  const windowKey = currentWindowKey(cadence);

  // G1 — a not-ready goal can't be filled or graded. Show a setup affordance
  // pointing back to Goals (where context is answered) instead of any fill UI.
  const needsSetup = health.status === HEALTH.NEEDS_SETUP;

  // Can we fill this goal right here? Needs a fill, an inline-capable
  // editor for its widget kind, and a resolved week to write against.
  const canInline =
    !needsSetup && health.needsFill && isInlineFillable(spec?.widget) && !!week;

  return (
    <Card padding={20} className="flex flex-col gap-3.5">
      {/* Header: kind · cadence label, tier badge + status badge on the right. */}
      <div className="flex items-center justify-between gap-2">
        <Label>
          {kindLabel}
          {cadence ? ` · ${capitalize(cadence)}` : ""}
        </Label>
        <div className="flex shrink-0 items-center gap-1.5">
          <GoalTierBadge goalId={goal?.id} spec={spec} />
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
      </div>

      <div className="truncate text-[15px] font-bold leading-[1.3] text-fg" title={goal?.title}>
        {goal?.title || spec?.title || "Untitled goal"}
      </div>

      {/* Body: setup hint (not ready) · live auto value (auto) · numeral + strip */}
      {needsSetup ? (
        <div className="text-[13px] leading-[1.4] text-muted-fg">{readinessLabel(health.readiness)}</div>
      ) : health.status === HEALTH.AUTO ? (
        <AutoGoalValue spec={spec} />
      ) : (
        <div className="flex flex-col gap-2">
          <FillHint health={health} cadence={cadence} />
          <FillCount fill={fill} cadence={cadence} trend={trend} />
        </div>
      )}

      {/* Footer: last entry + CTA */}
      <div className="flex items-center justify-between text-[12.5px] text-muted-fg">
        <span>
          {/* Auto goals aren't hand-logged — no "last logged" line for them;
              setup-pending goals have no log history yet either. */}
          {health.status === HEALTH.AUTO || needsSetup
            ? ""
            : fill?.lastEntryTs
              ? `Logged ${relAgo(fill.lastEntryTs)}`
              : "Never logged"}
        </span>
        <div className="flex items-center gap-3">
          {/* Not ready → the only action is to go finish setup in Goals. */}
          {needsSetup ? (
            <Link href={hubLink("/goals")} className="font-bold text-fg">
              {health.readiness === GOAL_READINESS.NEEDS_CONTEXT ? "Finish setup" : "View in Goals"}
            </Link>
          ) : null}
          {/* Lock controls — settle a window the user can't / won't fill. */}
          {!needsSetup && health.status === HEALTH.LOCKED ? (
            <button type="button" onClick={() => reopenCurrentWindow(goal?.id, windowKey)} className="text-muted-fg hover:text-fg">
              Reopen
            </button>
          ) : health.needsFill && windowKey ? (
            <button
              type="button"
              onClick={() => skipWindow(goal, windowKey)}
              className="text-muted-fg hover:text-fg"
              title="Mark this period settled — nothing to report"
            >
              Nothing to report
            </button>
          ) : null}

          {!health.needsFill ? null : canInline ? (
            <button type="button" onClick={() => setOpen((v) => !v)} className="font-bold text-fg">
              {open ? "Close" : "Fill now"}
            </button>
          ) : fillHref ? (
            // Heavy editors (rubric / scorecard) fill on the Goals page now.
            <Link href={fillHref} className="font-bold text-fg">
              Open in goals
            </Link>
          ) : null}
        </div>
      </div>

      {/* Inline editor — fill on the spot, scoped to the current work week.
          Writes hit goal-inputs immediately, so the card's status + fill
          strip update live (and the card may leave the focus view once
          it's no longer "needs attention"). */}
      {open && canInline ? (
        <div className="border-t border-line pt-3">
          <GoalManualEditor
            widget={spec.widget}
            goal={goal}
            spec={spec}
            weekStart={week.start}
            weekEnd={week.end}
            activeLabel={week.weekLabel}
          />
          <div className="mt-2 text-[11.5px] text-dim-fg">logging to {week.weekLabel}</div>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Names the window that needs filling, in the goal's cadence terms —
 * "This week not logged yet", "This quarter + 2 earlier empty", "Never
 * logged" — instead of leaving the user to read a bare ratio. Renders
 * nothing when the goal is up to date. The state signal already lives on
 * the header badge, so this line stays neutral text rather than repeating
 * it in color.
 */
function FillHint({ health, cadence }) {
  const [singular] = cadenceWindowLabel(cadence);
  let text = null;
  if (health.status === HEALTH.NO_DATA) {
    text = "Never logged — add your first entry";
  } else if (health.status === HEALTH.STALE) {
    const missed = health.missedWindows || 1;
    text =
      missed > 1
        ? `This ${singular} + ${missed - 1} earlier empty`
        : `This ${singular} not logged yet`;
  }
  if (!text) return null;
  return <div className="text-[12px] text-muted-fg">{text}</div>;
}

/**
 * Direction-of-travel badge. Coloured by GOODNESS (resolved against the
 * target op upstream), not raw direction — a falling turnaround time is
 * mint, not peach. Hidden when flat / not enough history.
 */
function TrendBadge({ trend }) {
  if (!trend || trend.dir === "flat") return null;
  const up = trend.dir === "up";
  const tone = trend.good == null ? "neutral" : trend.good ? "mint" : "peach";
  const title =
    trend.good == null
      ? `Trending ${trend.dir}`
      : trend.good
        ? "Improving vs last snapshot"
        : "Slipping vs last snapshot";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <Badge tone={tone} title={title} aria-label={title}>
      <Icon size={11} />
    </Badge>
  );
}

// Cap the DOT rendering (not the ratio) — a weekly/daily goal's full cycle
// is 52/365 windows, way too many for this compact card. The number always
// reflects the true full-cycle count; only the visual strip is trimmed to
// the most recent DOT_CAP windows.
const DOT_CAP = 12;

/**
 * "N / total windows" numeral + a trend badge, then the fill strip below it
 * — the actual fill PATTERN (gaps visible), not just a count. Cycle-anchored
 * (buildCycleWindows) — the SAME full-year window set the Goals-page cadence
 * stepper shows, so the ratio here always matches what that page reports.
 */
function FillCount({ fill, cadence, trend }) {
  // total:0 covers non-bucketing cadences (fill is a minimal stand-in there,
  // carrying only lastEntryTs for the footer) — no window concept to render.
  if (!fill || !fill.total) return null;
  const windows = Array.isArray(fill.windows) ? fill.windows : [];
  const total = fill.total ?? windows.length;
  const filled = fill.filledCount ?? windows.filter((w) => w?.filled).length;
  const noun = cadenceWindowLabel(cadence)[1]; // plural: weeks / months / …

  // windows[] is the FULL cycle year, oldest→newest, current-window through
  // year-end included as "future" entries — so slicing the array's TAIL
  // would show unstarted future periods for any cadence with >DOT_CAP total
  // windows (weekly/biweekly/daily), not recent activity. Center the visible
  // slice on currentIndex instead. Falls back to the tail if currentIndex is
  // ever unavailable (shouldn't happen once a real cycle is built, but keeps
  // this from rendering nothing on a malformed input).
  const idx = Number.isInteger(fill.currentIndex) ? fill.currentIndex : windows.length - 1;
  const visible =
    windows.length > DOT_CAP ? windows.slice(Math.max(0, idx - DOT_CAP + 1), idx + 1) : windows;
  const cells = visible.map((w) => ({ key: w?.key, label: w?.label, state: w?.state || "future" }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[30px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
          {filled}
        </span>
        <span className="text-[13px] text-muted-fg">/ {total} {noun}</span>
        <div className="ml-auto">
          <TrendBadge trend={trend} />
        </div>
      </div>
      <FillStrip cells={cells} size="sm" />
    </div>
  );
}
