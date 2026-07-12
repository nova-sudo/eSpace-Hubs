"use client";

/**
 * Focus hero — the one goal in the carousel, big and decisive. Renders a card
 * from useGoalHealth (tier-ranked, worst first): a status/tier pill, the primary
 * signal, the cadence fill strip, then EITHER the grader's reasoning (for a
 * Not-achieved goal) or a fill nudge, and a primary action that opens the goal's
 * widget in a MODAL — the ContextCollector for a needs-setup goal, or the widget
 * body + cadence stepper to fill/backfill missing periods — so the user acts
 * without leaving the page.
 *
 * Presentation only — data comes pre-derived on the card.
 */

import { useState } from "react";
import { Pill } from "@/components/ui";
import { SPEC_KIND_META, specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel } from "@/features/goal-inputs";
import { readinessLabel, GoalWidgetModal } from "@/features/goal-widgets";
import { currentWindowKey, setLock } from "@/features/goal-locks";
import { HEALTH } from "./status";

function daysSince(ts) {
  if (!ts) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 86_400_000));
}

/** Big-numeral signal per status — the one number the hero leads with. */
function heroSignal(health) {
  if (health?.status === HEALTH.NEEDS_SETUP) {
    return { big: "!", unit: "", sub: "not set up yet" };
  }
  const d = daysSince(health?.fill?.lastEntryTs);
  if (health?.status === HEALTH.NO_DATA || d == null) {
    return { big: "—", unit: "", sub: "never logged" };
  }
  if (health?.status === HEALTH.BEHIND) {
    return { big: String(d), unit: "d", sub: "since last logged · below target" };
  }
  return { big: String(d), unit: "d", sub: "since last logged" };
}

function statusChip(health) {
  if (health?.overdue) return { tone: "bad", label: "Gone quiet" };
  switch (health?.status) {
    case HEALTH.NEEDS_SETUP:
      return { tone: "warn", label: "Needs setup" };
    case HEALTH.BEHIND:
      return { tone: "bad", label: "Behind target" };
    case HEALTH.STALE:
      return { tone: "warn", label: "Gone quiet" };
    case HEALTH.NO_DATA:
    default:
      return { tone: "warn", label: "Not logged yet" };
  }
}

export function FocusHero({ card }) {
  const [modalOpen, setModalOpen] = useState(false);
  const { goal, spec, health, l1, tier, tierReasoning } = card;
  const needsSetup = health?.status === HEALTH.NEEDS_SETUP;
  // The carousel leads with the achievement tier, so a graded-failing goal reads
  // as "Not achieved" rather than by its fill status.
  const notAchieved = tier === "not_achieved";

  const chip = notAchieved
    ? { tone: "bad", label: "Not achieved" }
    : statusChip(health);
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const context = [kindLabel, l1?.category || l1?.title].filter(Boolean).join(" · ");
  const signal = heroSignal(health);
  const signalColor = chip.tone === "bad" ? "var(--bad)" : "var(--warn)";

  const cadence = specCadence(spec);
  const windowKey = currentWindowKey(cadence);
  // Only a fill goal gets "Skip for now" — settling a window doesn't answer
  // setup questions or fix a failing tier.
  const canSkip = !needsSetup && !notAchieved && !!windowKey;

  // Fill strip — cycle windows from deriveGoalHealth (oldest→newest objects),
  // capped to the 8 windows ENDING at the current one. total===0 = a
  // single-record/pip kind → no strip. Centre on currentIndex (not the array
  // tail): buildCycleWindows enumerates the whole calendar year, so the tail is
  // unstarted FUTURE windows.
  const fill = health?.fill;
  const STRIP_CAP = 8;
  const stripWindows = (() => {
    if (!fill || !fill.total || !Array.isArray(fill.windows)) return [];
    const idx = Number.isInteger(fill.currentIndex)
      ? fill.currentIndex
      : fill.windows.length - 1;
    return fill.windows.slice(Math.max(0, idx - STRIP_CAP + 1), idx + 1);
  })();
  const noun = cadenceWindowLabel(cadence)[1];

  return (
    <>
      <div
        className="relative overflow-hidden rounded-[16px] p-[30px]"
        style={{
          border: "1px solid var(--accent)",
          background: "linear-gradient(180deg, var(--accent-dim), transparent)",
        }}
      >
        {/* Accent dot-field corner (masked) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 h-[280px] w-[280px]"
          style={{
            backgroundImage: "radial-gradient(var(--accent) 1.3px, transparent 1.3px)",
            backgroundSize: "12px 12px",
            opacity: 0.14,
            WebkitMaskImage: "radial-gradient(circle at 70% 30%, #000, transparent 70%)",
            maskImage: "radial-gradient(circle at 70% 30%, #000, transparent 70%)",
          }}
        />

        <div className="relative">
          <div className="mb-[18px] flex items-center gap-2.5">
            <Pill tone={chip.tone}>
              <span
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: chip.tone === "bad" ? "var(--bad)" : "var(--warn)" }}
              />
              {chip.label}
            </Pill>
            <span
              className="uppercase tracking-[1px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
            >
              {context}
            </span>
          </div>

          <h2
            className="m-0 leading-[1.05] text-fg"
            style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 30, letterSpacing: "-0.5px" }}
            title={goal?.title}
          >
            {goal?.title || spec?.title || "Untitled goal"}
          </h2>

          <div className="mt-[22px] flex items-end gap-[26px]">
            <div>
              <div
                style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 66, lineHeight: 0.78, color: signalColor }}
              >
                {signal.big}
                {signal.unit ? (
                  <span style={{ fontSize: 30, color: "var(--dim-fg)" }}>{signal.unit}</span>
                ) : null}
              </div>
              <div
                className="mt-2 uppercase tracking-[1px] text-muted-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
              >
                {signal.sub}
              </div>
            </div>

            {stripWindows.length > 0 ? (
              <>
                <div className="h-[60px] w-px" style={{ background: "var(--border)" }} />
                <div>
                  <div className="flex gap-1.5">
                    {stripWindows.map((w, i) => (
                      <span
                        key={w?.key ?? i}
                        className="h-3 w-3 rounded-full"
                        style={{ background: w?.filled ? "var(--accent)" : "var(--dot-dim)" }}
                      />
                    ))}
                  </div>
                  <div
                    className="mt-2.5 uppercase tracking-[1px] text-muted-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
                  >
                    {fill.filledCount} of {fill.total} {noun}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {notAchieved && tierReasoning ? (
            <p
              className="mt-[22px] max-w-[460px] leading-[1.55] text-fg/85"
              style={{ fontFamily: "var(--font-sans)", fontSize: 14 }}
            >
              <span
                className="mr-1.5 uppercase tracking-[0.6px] text-muted-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              >
                Why:
              </span>
              {tierReasoning}
            </p>
          ) : (
            <p
              className="mt-[22px] max-w-[440px] leading-[1.55] text-muted-fg"
              style={{ fontFamily: "var(--font-sans)", fontSize: 14 }}
            >
              {needsSetup
                ? readinessLabel(health?.readiness) ||
                  "This goal needs setup before it can be tracked."
                : notAchieved
                  ? "Graded “Not achieved” — fill more, or open it to see what it takes to reach the next tier."
                  : "This is your most-slipping goal right now. Logging it keeps the goal healthy — it takes about a minute."}
            </p>
          )}

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-[11px] uppercase tracking-[1px] transition-[filter] hover:brightness-110"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--accent-on)",
                background: "var(--accent)",
                border: "1px solid var(--accent)",
                padding: "15px 26px",
              }}
            >
              {needsSetup ? "Set up →" : "Fill →"}
            </button>

            {canSkip ? (
              <button
                type="button"
                onClick={() => setLock(goal?.id, windowKey, true)}
                className="rounded-[11px] uppercase tracking-[0.8px] text-muted-fg transition-colors hover:text-fg"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  background: "transparent",
                  border: "1px solid var(--border-strong)",
                  padding: "15px 18px",
                }}
                title="Nothing to report this period — settle it and move on"
              >
                Skip for now
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <GoalWidgetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        spec={spec}
        goal={goal}
      />
    </>
  );
}
