"use client";

/**
 * Achievement-tier UI (Phase 3): a compact badge for dense lists (the
 * goal tree) and a full ladder for widget tiles. Both read the AI
 * verdict via `useGoalTier`; render nothing when the goal has no tiers
 * (not re-analyzed since tiers landed).
 */

import { useState } from "react";
import { updateSpecTiers } from "@/features/goal-specs";
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
  // Goal still needs setup — the surfaces that render this badge already
  // carry their own "Needs setup" affordance, so a second chip is noise.
  if (verdict.pendingSetup) return null;
  // W1: no usable reading yet — defer, don't show a misleading tier.
  if (verdict.awaiting) {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-[var(--radius-pill)] px-1.5 py-px uppercase tracking-[0.3px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--muted-fg)",
          border: "1px solid var(--border)",
        }}
        title={verdict.reasoning || "Awaiting data to grade this goal."}
      >
        awaiting data
      </span>
    );
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
  const { hasTiers, tiers, verdict, loading, regrade } = useGoalTier(
    spec?.goalId,
    spec,
  );
  const [editing, setEditing] = useState(false);
  const [regrading, setRegrading] = useState(false);
  if (!hasTiers) return null;

  // Manual re-grade — the escape hatch from the once-a-day throttle. Grading is
  // otherwise deferred to the next day's first view; this forces a fresh grade
  // against the latest data now.
  async function onRegrade() {
    if (regrading) return;
    setRegrading(true);
    try {
      await regrade?.();
    } finally {
      setRegrading(false);
    }
  }

  const tierMap = tiers || {};
  const current = verdict?.tier || null;
  const reachedIdx = current ? TIER_ORDER.indexOf(current) : -1;
  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";
  const dim = isLight ? "rgba(255,255,255,0.40)" : "var(--dim-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const surface = isLight ? "rgba(255,255,255,0.08)" : "var(--card-alt)";

  if (editing) {
    return (
      <TierEditor
        spec={spec}
        tiers={tierMap}
        variant={variant}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className="mt-3 rounded-[var(--radius-sub)] p-2"
      style={{ background: surface }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className="uppercase tracking-[0.5px]"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: muted }}
        >
          Achievement tier
          {spec?.tiersLocked ? " · 🔒" : ""}
          {(loading && !verdict) || regrading ? " · grading…" : ""}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {/* Manual re-grade — grading is throttled to once a day, so this is
              how the user forces a fresh grade after new activity lands. */}
          <button
            type="button"
            onClick={onRegrade}
            disabled={regrading}
            className="uppercase tracking-[0.5px] hover:opacity-100 disabled:opacity-40"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: muted,
              opacity: 0.8,
            }}
            title="Re-grade this goal now against the latest data"
          >
            {regrading ? "grading…" : "re-grade"}
          </button>
          {/* The criteria belong to the goal owner — let them correct what the
              AI extracted. Editing re-grades against the new criteria; saving
              locks them so re-analysis won't overwrite. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="uppercase tracking-[0.5px] hover:opacity-100"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: muted,
              opacity: 0.8,
            }}
            title={
              spec?.tiersLocked
                ? "Criteria locked — re-analysis won't overwrite. Click to edit or unlock."
                : "Edit the achievement-tier criteria for this goal"
            }
          >
            edit
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {TIER_ORDER.map((t, i) => {
          const criterion = tierMap[TIER_FIELD[t]];
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

/**
 * Inline editor for the four tier criteria. The criteria are the goal
 * owner's contract — the AI only drafts them — so this lets the user
 * correct mis-extractions. Saving writes the criteria back onto the spec
 * (`saveSpec`), which re-grades the goal against the new criteria.
 */
function TierEditor({ spec, tiers, variant, onClose }) {
  const isLight = variant === "light";
  const muted = isLight ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";
  const fg = isLight ? "#ffffff" : "var(--fg)";
  const surface = isLight ? "rgba(255,255,255,0.08)" : "var(--card-alt)";
  const fieldBg = isLight ? "rgba(255,255,255,0.10)" : "var(--bg)";
  const fieldBorder = isLight
    ? "1px solid rgba(255,255,255,0.22)"
    : "1px solid var(--border)";

  const [draft, setDraft] = useState(() => ({
    notAchieved: tiers.notAchieved || "",
    achieved: tiers.achieved || "",
    overAchieved: tiers.overAchieved || "",
    roleModel: tiers.roleModel || "",
  }));
  const [saving, setSaving] = useState(false);
  const locked = spec?.tiersLocked === true;

  function draftTiers() {
    return {
      notAchieved: draft.notAchieved.trim() || null,
      achieved: draft.achieved.trim() || null,
      overAchieved: draft.overAchieved.trim() || null,
      roleModel: draft.roleModel.trim() || null,
    };
  }

  // Save + LOCK: the user owns these criteria now, so re-analysis won't
  // overwrite them. Updates the spec → the goal re-grades on the new tiers.
  function save() {
    setSaving(true);
    updateSpecTiers(spec.goalId, draftTiers(), true);
    setSaving(false);
    onClose?.();
  }

  // Drop the lock so a future re-analysis may regenerate the criteria
  // (keeps the current edits as the spec's tiers until then).
  function unlock() {
    setSaving(true);
    updateSpecTiers(spec.goalId, draftTiers(), false);
    setSaving(false);
    onClose?.();
  }

  return (
    <div
      className="mt-3 rounded-[var(--radius-sub)] p-2"
      style={{ background: surface }}
    >
      <div
        className="mb-1.5 uppercase tracking-[0.5px]"
        style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: muted }}
      >
        Edit achievement-tier criteria{locked ? " · 🔒 locked" : ""}
      </div>
      <div className="flex flex-col gap-1.5">
        {TIER_ORDER.map((t) => {
          const field = TIER_FIELD[t];
          return (
            <label key={t} className="flex flex-col gap-0.5">
              <span
                className="uppercase"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 8.5,
                  letterSpacing: "0.3px",
                  color: TIER_COLOR[t],
                }}
              >
                {TIER_LABELS[t]}
              </span>
              <textarea
                rows={2}
                value={draft[field]}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [field]: e.target.value }))
                }
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 10.5,
                  lineHeight: 1.35,
                  color: fg,
                  background: fieldBg,
                  border: fieldBorder,
                  borderRadius: "var(--radius-sub)",
                  padding: "4px 6px",
                  resize: "vertical",
                  width: "100%",
                  outline: "none",
                }}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-[var(--radius-sub)] px-2.5 py-1 font-bold uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.5px",
            background: isLight ? "#ffffff" : "var(--accent)",
            color: isLight ? "var(--accent)" : "var(--accent-on)",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save & lock"}
        </button>
        {locked ? (
          <button
            type="button"
            onClick={unlock}
            disabled={saving}
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: muted,
            }}
            title="Allow re-analysis to regenerate these criteria"
          >
            Unlock
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="uppercase tracking-[0.5px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: muted,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
