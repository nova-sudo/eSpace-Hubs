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
import { isAssignedGoalId } from "@espace-devhub/shared/goal-specs";
import { useGoalTier, TIER_ORDER, TIER_LABELS, TIER_FIELD } from "./use-goal-tier";
import { readTierPolicy } from "./tier-policy-store";
import { tierTone } from "./tier-colors";
import { TierDeltaBadge } from "./tier-move";
import { ManagerGradeAck } from "./manager-grade-ack";

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
export function GoalTierLadder({ spec, rubric = null, variant: _variant = "light" }) {
  const { hasTiers, tiers, tierGoverned, verdict, loading, regrade } = useGoalTier(
    spec?.goalId,
    spec,
  );
  const [editing, setEditing] = useState(false);
  const [regrading, setRegrading] = useState(false);
  // The Goal Code whose manager policy governs this ladder (the tier
  // store is already hydrated + subscribed by useGoalTier above).
  const governingCode = tierGoverned ? readTierPolicy(spec?.goalId)?.code || null : null;
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
        {rubric && rubric.trim() ? (
          // No scored levels — but the goal sheet's own rubric still says
          // what "good" looks like, and it's the only "why" a grade has.
          <>
            <p className="whitespace-pre-line text-[13px] leading-[1.55] text-fg">
              {rubric.trim()}
            </p>
            <p className="text-[12px] leading-[1.5] text-muted-fg">
              From your goal sheet. There are no scored levels yet — re-analyzing
              the goal writes them from this rubric.
            </p>
          </>
        ) : isAssignedGoalId(spec?.goalId) ? (
          <p className="text-[13px] leading-[1.5] text-muted-fg">
            This shared goal has no levels of its own. The person who shared it
            (or your line manager) grades it, or a tier policy for its code does.
          </p>
        ) : (
          <p className="text-[13px] leading-[1.5] text-muted-fg">
            This goal has no levels to grade against, so it can&apos;t be scored. That
            happens when it was classified before levels were part of a tracker.
            Re-analyzing the goal writes them from its rubric.
          </p>
        )}
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
  const gradedAgo = relativeAgo(verdict?.gradedAt);

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label>Achievement levels</Label>
          {tierGoverned ? (
            // "How you're graded" (hub-audit §5): name the policy that sets
            // the bar, not just that one exists.
            <Badge
              tone="sky"
              title="A manager's level policy for this goal's code sets these criteria. Only a manager can change them — from the Manager Hub's Goals & policies."
            >
              {governingCode
                ? `Set by your manager's policy: ${governingCode}`
                : "Set by your manager's policy"}
            </Badge>
          ) : null}
          {isManager ? (
            <Badge tone="sky" title="Your manager graded this goal directly; it outranks the AI grade.">
              Manager verdict
            </Badge>
          ) : null}
          {gradedAgo ? (
            <span className="text-[11.5px] text-muted-fg">Last graded {gradedAgo}</span>
          ) : null}
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
          {!tierGoverned && !isAssignedGoalId(spec?.goalId) ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12px] font-semibold text-muted-fg hover:text-fg"
              title={
                spec?.tiersLocked
                  ? "Criteria kept on re-analyze — click to edit or let re-analysis regenerate them."
                  : "Edit the achievement-level criteria for this goal"
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
                  isCurrent ? "opacity-80" : "text-muted-fg",
                )}
              >
                {criterion || "Not described"}
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
          {/* The report's acknowledgement + grade history. */}
          <ManagerGradeAck goalId={spec?.goalId} />
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
  const [error, setError] = useState(null);
  const locked = spec?.tiersLocked === true;

  function draftTiers() {
    return {
      notAchieved: draft.notAchieved.trim() || null,
      achieved: draft.achieved.trim() || null,
      overAchieved: draft.overAchieved.trim() || null,
      roleModel: draft.roleModel.trim() || null,
    };
  }

  // `updateSpecTiers` validates synchronously and returns `{ ok, errors }`;
  // an ignored `ok:false` closed the editor as if it had saved.
  function commit(keepOnReanalyze) {
    setSaving(true);
    setError(null);
    const res = updateSpecTiers(spec.goalId, draftTiers(), keepOnReanalyze);
    setSaving(false);
    if (!res?.ok) {
      setError((res?.errors || []).join(", ") || "Couldn't save these criteria.");
      return;
    }
    onClose?.();
  }

  // Save + KEEP: the user owns these criteria now, so re-analysis won't
  // overwrite them. Updates the spec → the goal re-grades on the new tiers.
  const save = () => commit(true);
  // Drop the keep flag so a future re-analysis may regenerate the criteria
  // (keeps the current edits as the spec's tiers until then).
  const unlock = () => commit(false);

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
      <div className="flex items-center gap-2">
        <Label>Edit achievement-level criteria</Label>
        {locked ? (
          <Badge tone="neutral" title="These criteria survive a re-analysis.">
            Kept on re-analyze
          </Badge>
        ) : null}
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
                className="w-full resize-y rounded-[var(--radius-lg)] bg-card p-3 text-[13px] leading-[1.4] text-fg border border-field-line outline-none focus:ring-2 focus:ring-ink"
              />
            </label>
          );
        })}
      </div>
      {error ? <div className="text-[12.5px] leading-[1.4] text-peach-text">{error}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={save}
          disabled={saving}
          title="Save these criteria and keep them when the goal is re-analyzed"
        >
          {saving ? "Saving…" : "Save & keep on re-analyze"}
        </Button>
        {locked ? (
          <Button
            size="sm"
            variant="soft"
            onClick={unlock}
            disabled={saving}
            title="Save, but let the next re-analysis regenerate these criteria"
          >
            Save & allow regenerate
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function relativeAgo(ts) {
  const n = typeof ts === "string" ? Date.parse(ts) : ts;
  if (!Number.isFinite(n) || n <= 0) return null;
  const min = Math.floor((Date.now() - n) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
