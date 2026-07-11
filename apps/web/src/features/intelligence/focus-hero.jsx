"use client";

/**
 * Focus hero — the single most-slipping goal, big and decisive.
 *
 * Renders `queue[0]` from useGoalHealth() (already severity-sorted, so [0] is
 * THE thing that needs the user most). Accent-bordered card with a dot-field
 * corner, a status pill, the primary signal as a big Doto numeral (days since
 * last logged), the fill strip, a one-line narrative, and two actions:
 *   - primary  "Fill now" — the same inline GoalManualEditor the grid uses,
 *              scoped to the current work week (heavy kinds link to Goals)
 *   - secondary "Skip for now" — settle the current window ("nothing to
 *              report"), the existing goal-locks escape hatch, which drops the
 *              goal out of the attention queue.
 *
 * Presentation only — all data comes pre-derived on the card.
 */

import { useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/ui";
import { SPEC_KIND_META, specCadence } from "@/features/goal-specs";
import { cadenceWindowLabel } from "@/features/goal-inputs";
import { GoalManualEditor, isInlineFillable } from "@/features/goal-editors";
import { currentWindowKey, setLock } from "@/features/goal-locks";
import { useHubLink } from "@/features/hubs";
import { HEALTH } from "./status";

function daysSince(ts) {
  if (!ts) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 86_400_000));
}

/** Big-numeral signal per status — the one number the hero leads with. */
function heroSignal(health) {
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
    case HEALTH.BEHIND:
      return { tone: "bad", label: "Behind target" };
    case HEALTH.STALE:
      return { tone: "warn", label: "Gone quiet" };
    case HEALTH.NO_DATA:
    default:
      return { tone: "warn", label: "Not logged yet" };
  }
}

export function FocusHero({ card, week }) {
  const [open, setOpen] = useState(false);
  const link = useHubLink();
  const { goal, spec, health, l1 } = card;

  const chip = statusChip(health);
  const kindLabel = SPEC_KIND_META[spec?.widget]?.label ?? "Goal";
  const context = [kindLabel, l1?.category || l1?.title].filter(Boolean).join(" · ");
  const signal = heroSignal(health);
  const signalColor = chip.tone === "bad" ? "var(--bad)" : "var(--warn)";

  const cadence = specCadence(spec);
  const windowKey = currentWindowKey(cadence);
  const canInline = isInlineFillable(spec?.widget) && !!week;

  // Fill strip — cycle windows from deriveGoalHealth (oldest→newest objects),
  // capped to the most recent 8. total===0 = a single-record/pip kind → no strip.
  const fill = health?.fill;
  const stripWindows =
    fill && fill.total > 0 && Array.isArray(fill.windows)
      ? fill.windows.slice(-8)
      : [];
  const noun = cadenceWindowLabel(cadence)[1];

  return (
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

        <p
          className="mt-[22px] max-w-[440px] leading-[1.55] text-muted-fg"
          style={{ fontFamily: "var(--font-sans)", fontSize: 14 }}
        >
          This is your most-slipping goal right now. Logging it keeps the goal
          healthy — it takes about a minute.
        </p>

        <div className="mt-6 flex items-center gap-3">
          {canInline ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
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
              {open ? "Close" : "Log it now →"}
            </button>
          ) : (
            <Link
              href={link("/goals")}
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
              Open in goals →
            </Link>
          )}

          {windowKey ? (
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

        {open && canInline ? (
          <div className="mt-5 border-t border-border pt-4">
            <GoalManualEditor
              widget={spec.widget}
              goal={goal}
              spec={spec}
              weekStart={week.start}
              weekEnd={week.end}
              activeLabel={week.weekLabel}
            />
            <div
              className="mt-2 uppercase tracking-[0.4px] text-muted-fg/60"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
            >
              logging to {week.weekLabel}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
