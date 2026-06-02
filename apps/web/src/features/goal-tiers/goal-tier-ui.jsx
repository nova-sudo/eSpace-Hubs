"use client";

/**
 * Achievement-tier UI (Phase 3): a compact badge for dense lists (the
 * goal tree) and a full ladder for widget tiles. Both read the AI
 * verdict via `useGoalTier`; render nothing when the goal has no tiers
 * (not re-analyzed since tiers landed).
 */

import { useGoalTier, TIER_ORDER, TIER_LABELS, TIER_FIELD } from "./use-goal-tier";

const TIER_COLOR = {
  not_achieved: "#b91c1c", // bad
  achieved: "#1D4ED8", // accent
  over_achieved: "#00c48a", // accent-2
  role_model: "#f59e0b", // amber — exemplary
};
const TIER_SHORT = {
  not_achieved: "Not met",
  achieved: "Achieved",
  over_achieved: "Over",
  role_model: "Role model",
};

/**
 * One-line tier chip for the goal tree's L2 rows. Solid colored pill +
 * a tooltip carrying the AI's reasoning. Shows a muted "tier…" while the
 * first grade is in flight, and nothing at all when the goal has no
 * tiers yet.
 */
export function GoalTierBadge({ goalId, spec }) {
  const { hasTiers, verdict, loading } = useGoalTier(goalId, spec);
  if (!hasTiers) return null;
  if (!verdict) {
    return loading ? (
      <span
        className="shrink-0 uppercase tracking-[0.3px] text-dim-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
        title="Grading achievement tier…"
      >
        tier…
      </span>
    ) : null;
  }
  const color = TIER_COLOR[verdict.tier] || "var(--muted-fg)";
  const title =
    `${TIER_LABELS[verdict.tier]}` +
    (verdict.reasoning ? ` — ${verdict.reasoning}` : "") +
    (verdict.confidence === "low" ? " (low confidence)" : "");
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-[var(--radius-pill)] px-1.5 py-px font-bold uppercase tracking-[0.3px]"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        color: "#ffffff",
        background: color,
      }}
      title={title}
    >
      {TIER_SHORT[verdict.tier]}
    </span>
  );
}

/**
 * Full four-rung ladder for a widget tile. Highlights the rung the dev
 * is currently at ("← you"), dims rungs above it, and shows the AI's
 * one-line reasoning. Theme-aware via `variant` ("light" inverse tiles /
 * "dark" white tiles).
 */
export function GoalTierLadder({ spec, variant = "light" }) {
  const { hasTiers, tiers, verdict, loading } = useGoalTier(spec?.goalId, spec);
  if (!hasTiers) return null;

  const current = verdict?.tier || null;
  const reachedIdx = current ? TIER_ORDER.indexOf(current) : -1;
  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";
  const dim = isLight ? "rgba(255,255,255,0.40)" : "var(--dim-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const surface = isLight ? "rgba(255,255,255,0.08)" : "var(--card-alt)";

  return (
    <div
      className="mt-3 rounded-[var(--radius-sub)] p-2"
      style={{ background: surface }}
    >
      <div
        className="mb-1.5 uppercase tracking-[0.5px]"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: muted }}
      >
        Achievement tier{loading && !verdict ? " · grading…" : ""}
      </div>
      <div className="flex flex-col gap-1">
        {TIER_ORDER.map((t, i) => {
          const criterion = tiers[TIER_FIELD[t]];
          const isCurrent = t === current;
          const reached = reachedIdx >= 0 && i <= reachedIdx;
          const color = TIER_COLOR[t];
          return (
            <div
              key={t}
              className="flex items-start gap-1.5"
              style={{ opacity: reached || isCurrent ? 1 : 0.5 }}
            >
              <span
                className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: reached ? color : "transparent",
                  border: `1px solid ${color}`,
                }}
              />
              <span
                className="shrink-0 font-bold uppercase"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.3px",
                  color: isCurrent ? color : muted,
                  width: 64,
                }}
              >
                {TIER_LABELS[t]}
              </span>
              <span
                className="min-w-0 flex-1"
                style={{ fontSize: 10.5, lineHeight: 1.35, color: isCurrent ? fg : muted }}
              >
                {criterion || <span style={{ color: dim }}>—</span>}
              </span>
              {isCurrent ? (
                <span
                  className="shrink-0 uppercase"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, color }}
                >
                  ← you
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {verdict?.reasoning ? (
        <div
          className="mt-1.5"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            color: muted,
            lineHeight: 1.4,
          }}
        >
          {verdict.reasoning}
          {verdict.confidence === "low" ? " · low confidence" : ""}
        </div>
      ) : null}
    </div>
  );
}
