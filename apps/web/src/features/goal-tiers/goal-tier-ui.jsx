"use client";

/**
 * Achievement-tier UI (Phase 3): a compact badge for dense lists (the
 * goal tree) and a full ladder for widget tiles. Both read the AI
 * verdict via `useGoalTier`; render nothing when the goal has no tiers
 * (not re-analyzed since tiers landed).
 */

import { useState } from "react";
import { Check } from "lucide-react";
import { Badge, InsightRow, Label, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { updateSpecTiers } from "@/features/goal-specs";
import { useGoalTier, TIER_ORDER, TIER_LABELS, TIER_FIELD } from "./use-goal-tier";
import { tierTone } from "./tier-colors";
import { TierDeltaBadge } from "./tier-move";

/** Ladder cell background/ink for the currently-reached tier. */
const CELL_TONE_CLASS = {
  peach: "bg-peach text-peach-ink",
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  lav: "bg-lav text-lav-ink",
  neutral: "bg-card-alt text-muted-fg",
};

/**
 * One-line tier chip for the goal tree's L2 rows. A tone-matched Badge +
 * a tooltip carrying the AI's reasoning, or a lemon "Grading…" Badge while
 * the first grade is in flight.
 *
 * A CLASSIFIED goal whose spec carries no `tiers` used to render nothing
 * at all, which is indistinguishable from "graded fine" — the goal simply
 * looked blank forever with no way to tell why. Specs classified before the
 * classifier emitted tiers are exactly this case, so say so and point at
 * the fix. An UNCLASSIFIED goal (no spec) still renders nothing: the
 * surfaces that show this badge already mark those as unclassified.
 */
export function GoalTierBadge({ goalId, spec }) {
  const { hasTiers, verdict, loading } = useGoalTier(goalId, spec);
  if (!hasTiers) {
    if (!spec) return null;
    return (
      <Badge
        tone="neutral"
        title="This goal was classified before achievement levels were set, so there is nothing to grade against. Re-analyze it to generate them."
      >
        No levels set
      </Badge>
    );
  }
  if (!verdict) {
    return loading ? <Badge tone="lemon">Grading…</Badge> : null;
  }
  // Goal still needs setup — the surfaces that render this badge already
  // carry their own "Needs setup" affordance, so a second chip is noise.
  if (verdict.pendingSetup) return null;
  // W1: no usable reading yet — defer, don't show a misleading tier.
  if (verdict.awaiting) {
    return (
      <Badge tone="lemon" title={verdict.reasoning || "Awaiting data to grade this goal."}>
        Awaiting data
      </Badge>
    );
  }
  const title =
    `${TIER_LABELS[verdict.tier]}` +
    (verdict.reasoning ? ` — ${verdict.reasoning}` : "") +
    (verdict.source === "manager"
      ? ` · Graded by ${verdict.gradedByName || "your manager"}`
      : verdict.confidence === "low"
        ? " (low confidence)"
        : "");
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <Badge tone={tierTone(verdict.tier)} title={title}>
        {TIER_LABELS[verdict.tier]}
      </Badge>
      {/* F9: fresh rung-move delta, rendered inline for ~6s. */}
      <TierDeltaBadge goalId={goalId} />
    </span>
  );
}

/**
 * Full four-rung ladder for a widget tile. Highlights the rung the dev
 * is currently at (a check mark on the name), dims the rest, and shows
 * the AI's one-line reasoning as an insight row. `variant` is accepted
 * for back-compat with callers that used to pick a light/dark tile skin;
 * the ladder now renders the same token-based surface either way.
 */
export function GoalTierLadder({ spec, variant: _variant = "light" }) {
  const { hasTiers, tiers, tierGoverned, verdict, loading, regrade } = useGoalTier(
    spec?.goalId,
    spec,
  );
  const [editing, setEditing] = useState(false);
  const [regrading, setRegrading] = useState(false);
  // Same gap as the badge above: a classified goal with no tiers rendered an
  // empty space where the ladder belongs. Explain it and name the action.
  if (!hasTiers) {
    if (!spec) return null;
    return (
      <div
        className="flex flex-col gap-2 rounded-[var(--radius-xl)] bg-card p-5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <Label>Achievement levels</Label>
        <p className="text-[13px] leading-[1.5] text-muted-fg">
          This goal has no levels to grade against, so it can&apos;t be scored. That
          happens when it was classified before levels were part of a tracker.
          Re-analyzing the goal writes them from its rubric.
        </p>
      </div>
    );
  }

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

  if (editing) {
    return <TierEditor spec={spec} tiers={tierMap} onClose={() => setEditing(false)} />;
  }

  const isManager = verdict?.source === "manager";

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label>Achievement tier</Label>
          {tierGoverned ? <Badge tone="sky">Manager-governed</Badge> : null}
          {isManager ? <Badge tone="sky">Manager verdict</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Manual re-grade — grading is throttled to once a day, so this is
              how the user forces a fresh grade after new activity lands. */}
          {!isManager ? (
            <button
              type="button"
              onClick={onRegrade}
              disabled={regrading}
              className="text-[12px] font-semibold text-muted-fg hover:text-fg disabled:opacity-50"
              title="Re-grade this goal now against the latest data"
            >
              {regrading || (loading && !verdict) ? "Grading…" : "Re-grade"}
            </button>
          ) : null}
          {/* The criteria belong to the goal owner — let them correct what the
              AI extracted. Editing re-grades against the new criteria; saving
              locks them so re-analysis won't overwrite. Hidden when a manager
              tier policy governs this goal — the criteria aren't the dev's to
              edit in that case; a manager changes them from the Manager Hub. */}
          {!tierGoverned ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12px] font-semibold text-muted-fg hover:text-fg"
              title={
                spec?.tiersLocked
                  ? "Criteria locked — re-analysis won't overwrite. Click to edit or unlock."
                  : "Edit the achievement-tier criteria for this goal"
              }
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {TIER_ORDER.map((t) => {
          const criterion = tierMap[TIER_FIELD[t]];
          const isCurrent = t === current;
          const toneClass = isCurrent ? CELL_TONE_CLASS[tierTone(t)] : "bg-card-alt";
          return (
            <div key={t} className={cn("rounded-[var(--radius-md)] p-3", toneClass)}>
              <div
                className={cn(
                  "flex items-center gap-1 text-[11.5px] font-bold",
                  isCurrent ? "" : "text-muted-fg",
                )}
              >
                {TIER_LABELS[t]}
                {isCurrent ? <Check size={11} aria-hidden="true" /> : null}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-[11.5px]",
                  isCurrent ? "opacity-80" : "text-dim-fg",
                )}
              >
                {criterion || "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* F9: fresh rung-move delta beside the ladder for ~6s. */}
      <TierDeltaBadge goalId={spec?.goalId} />

      {isManager ? (
        <div className="rounded-[var(--radius-lg)] bg-sky p-3.5 text-[13px] text-sky-ink">
          Graded by {verdict.gradedByName || "your manager"}
          {verdict.reasoning ? ` — ${verdict.reasoning}` : ""}
        </div>
      ) : verdict?.reasoning ? (
        <InsightRow
          tone="lav"
          action={{ label: regrading ? "Grading…" : "Re-grade", onClick: onRegrade }}
        >
          {verdict.reasoning}
          {verdict.confidence === "low" ? " · Low confidence." : ""}
        </InsightRow>
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
function TierEditor({ spec, tiers, onClose }) {
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
    <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
      <div className="flex items-center gap-2">
        <Label>Edit achievement-tier criteria</Label>
        {locked ? <Badge tone="neutral">Locked</Badge> : null}
      </div>
      <div className="flex flex-col gap-2.5">
        {TIER_ORDER.map((t) => {
          const field = TIER_FIELD[t];
          return (
            <label key={t} className="flex flex-col gap-1">
              <Badge tone={tierTone(t)} className="w-fit">
                {TIER_LABELS[t]}
              </Badge>
              <textarea
                rows={2}
                value={draft[field]}
                onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                className="w-full resize-y rounded-[var(--radius-lg)] bg-card p-3 text-[13px] leading-[1.4] text-fg outline-none focus:ring-2 focus:ring-ink"
              />
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save & lock"}
        </Button>
        {locked ? (
          <Button size="sm" variant="soft" onClick={unlock} disabled={saving}>
            Unlock
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
