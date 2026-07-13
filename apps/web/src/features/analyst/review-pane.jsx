"use client";

/**
 * Review pane — shown after classification completes, before any spec
 * is committed to the goal-specs store.
 *
 * Each pending spec is rendered as a card with:
 *   - goal title + parent L1 breadcrumb
 *   - the classifier's reasoning (one-liner)
 *   - widget + kind dropdowns for inline override
 *   - block summary (source for auto, manual for manual, …)
 *   - per-card Save / Skip buttons
 *
 * Bulk actions at the top:
 *   - "Save all"     — commits every pending spec, surfaces any
 *                       validation failures as a list
 *   - "Discard all"  — clears the buffer without committing anything
 *
 * Failed classifications (goals with no spec in the buffer) are listed
 * in a separate "Failed to classify" strip at the bottom with a
 * "Retry this goal" button that re-runs classifier on just that goal.
 *
 * The per-component / per-target / scope editors live in `./spec-editors`
 * so the per-widget "edit setup" modal can reuse them on a committed spec.
 */

import { useMemo, useState } from "react";
import { Select } from "@/components/ui";
import {
  SPEC_VARIANTS,
  ALL_SPEC_KINDS,
  ALL_SPEC_VARIANTS,
  SPEC_KIND_META,
} from "@/features/goal-specs";
import {
  useCombinedMergedSince,
  listReposFromMrs,
  useJenkinsJobs,
} from "@/features/integrations";
import { isoDaysAgo } from "@/lib/date";
import { ANALYSIS } from "./ai/analysis-events";
import {
  ScorecardEditor,
  RepoPicker,
  JobPicker,
  patchFilter,
} from "./spec-editors";

// Map each widget to the kind(s) that are valid for it. The validator
// already enforces this; we duplicate it here so the kind dropdown
// disables incompatible combinations BEFORE the user tries to save.
function validKindsFor(widget) {
  const meta = SPEC_KIND_META[widget];
  if (!meta) return ALL_SPEC_VARIANTS;
  if (meta.variant === SPEC_VARIANTS.MANUAL) return [SPEC_VARIANTS.MANUAL];
  // AUTO widgets: pure auto (e.g. MERGED_COUNT, CODE_RUBRIC) OR hybrid
  // (auto+manual). MANUAL kind is never valid here.
  return [SPEC_VARIANTS.AUTO, SPEC_VARIANTS.HYBRID];
}

/**
 * Build a fresh 2-component SCORECARD seed when the user switches
 * widget to SCORECARD without the AI having emitted one. The seeds
 * are MERGED_COUNT components with no target — the user picks the
 * actual widget + target via the per-component editor.
 *
 * Even-split weights match the user's stated preference for default
 * weighting. Aggregate is always "weighted" in MVP.
 */
function seedScorecard() {
  const bare = () => ({
    label: "",
    weight: 50,
    widget: "MERGED_COUNT",
    kind: "auto",
    source: {
      provider: "combined",
      metric: "merged_count",
      window: "30d",
      target: null,
    },
    manual: null,
  });
  return {
    aggregate: "weighted",
    components: [bare(), bare()],
  };
}

/**
 * Build (or augment) a context block so CODE_RUBRIC has the
 * `quality-standards` list question it needs. Preserves any other
 * questions the user / AI already added; only inserts the required
 * one when missing. Idempotent — safe to call on any spec.context.
 */
function ensureRubricContext(existing) {
  const questions = Array.isArray(existing?.questions)
    ? [...existing.questions]
    : [];
  const has = questions.some((q) => q?.id === "quality-standards");
  if (!has) {
    questions.unshift({
      id: "quality-standards",
      prompt: "What are the team's code quality standards?",
      kind: "list",
      placeholder: "e.g. test coverage, naming, docs",
    });
  }
  return { required: true, questions };
}

export function ReviewPane({
  pendingSpecs,
  events,
  commitSpec,
  commitAllPending,
  discardSpec,
  discardAllPending,
  updatePendingSpec,
  onSwitchToGrid,
  onRetryGoal,
}) {
  const goalsById = useMemo(() => indexGoalMetaFromEvents(events), [events]);
  const failed = useMemo(() => extractFailures(events, pendingSpecs), [
    events,
    pendingSpecs,
  ]);

  // Derive the repo dropdown options from the user's merged MRs over a
  // 90d window. Uses the same SWR cache key as the metrics layer so
  // this is effectively a free read when the analyst is open after a
  // dashboard visit. Returns an empty list when GitHub/GitLab isn't
  // connected — the picker falls back to a free-text input in that case.
  const merged90 = useCombinedMergedSince(isoDaysAgo(90));
  const repoOptions = useMemo(
    () => listReposFromMrs(merged90.data || []),
    [merged90.data],
  );
  // Phase D3: Jenkins jobs for the JobPicker. Same SWR cache key as
  // the QA dashboard, so opening the analyst after browsing the
  // dashboard reuses the response. When Jenkins isn't connected the
  // hook returns an empty array — the picker falls back to free-text.
  const { jobs: jenkinsJobs } = useJenkinsJobs();
  const jobOptions = useMemo(
    () =>
      (jenkinsJobs || [])
        .map((j) => (j && typeof j.name === "string" ? j.name : null))
        .filter(Boolean)
        .sort(),
    [jenkinsJobs],
  );

  const [bulkError, setBulkError] = useState(null);
  const pendingEntries = Object.entries(pendingSpecs);

  const handleSaveAll = () => {
    setBulkError(null);
    const { saved, failed: rejectedSpecs } = commitAllPending();
    if (rejectedSpecs.length > 0) {
      setBulkError(
        `${saved} saved, ${rejectedSpecs.length} rejected by validator. ` +
          `Fix or skip the highlighted goals.`,
      );
    } else if (saved > 0) {
      // Clean run — go to the widget grid.
      onSwitchToGrid?.();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <BulkStrip
        pendingCount={pendingEntries.length}
        failedCount={failed.length}
        bulkError={bulkError}
        onSaveAll={handleSaveAll}
        onDiscardAll={() => {
          setBulkError(null);
          discardAllPending();
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
        {pendingEntries.length === 0 && failed.length === 0 ? (
          <EmptyPlaceholder onSwitchToGrid={onSwitchToGrid} />
        ) : null}

        {pendingEntries.map(([goalId, spec]) => (
          <PendingCard
            key={goalId}
            goalId={goalId}
            spec={spec}
            meta={goalsById.get(goalId)}
            repoOptions={repoOptions}
            jobOptions={jobOptions}
            onSave={() => {
              const result = commitSpec(goalId);
              if (!result.ok) {
                setBulkError(
                  `Validator rejected ${goalId.slice(-4)}: ${result.errors?.join(
                    "; ",
                  )}`,
                );
              } else {
                setBulkError(null);
              }
            }}
            onSkip={() => discardSpec(goalId)}
            onChangeWidget={(widget) => {
              const kindsOk = validKindsFor(widget);
              const nextKind = kindsOk.includes(spec.kind)
                ? spec.kind
                : kindsOk[0];
              const patch = { widget, kind: nextKind };
              // CODE_RUBRIC needs a `context.required: true` block
              // with a `quality-standards` list question, otherwise
              // the dashboard renders the widget's "Define your
              // rubric first" placeholder with no edit-truths affordance
              // (because the `controls.onEditContext` chip only mounts
              // when context.questions exists). Seed it on switch so
              // GoalWidget routes straight to the ContextCollector.
              if (
                widget === "CODE_RUBRIC" &&
                !(spec.context?.required &&
                  (spec.context?.questions || []).some(
                    (q) => q.id === "quality-standards",
                  ))
              ) {
                patch.context = ensureRubricContext(spec.context);
                // CODE_RUBRIC forbids source — clear it.
                if (spec.source) patch.source = null;
              }
              // SCORECARD owns its data through components. Seed
              // two bare AUTO components on switch so the editor
              // has rows to render; user picks their widgets/targets
              // from there. Top-level source/manual MUST be null
              // (validator rejects otherwise) so we clear both.
              if (widget === "SCORECARD" && !spec.scorecard) {
                patch.scorecard = seedScorecard();
                patch.source = null;
                patch.manual = null;
                // SCORECARD's kind tracks its components' variants;
                // bare seed is all-AUTO so kind must be "auto".
                patch.kind = "auto";
              }
              // Switching AWAY from SCORECARD: clear scorecard so the
              // validator's "scorecard required for SCORECARD widget"
              // pairing rule doesn't leave a dangling block.
              if (widget !== "SCORECARD" && spec.scorecard) {
                patch.scorecard = null;
              }
              updatePendingSpec(goalId, patch);
            }}
            onChangeKind={(kind) => updatePendingSpec(goalId, { kind })}
            onSetUntrackable={(reason) =>
              updatePendingSpec(goalId, {
                untrackable: reason ? { reason } : null,
              })
            }
            onChangeRepo={(repo) => {
              updatePendingSpec(goalId, {
                source: patchFilter(spec.source, "repo", repo),
              });
            }}
            onChangeJob={(job) => {
              updatePendingSpec(goalId, {
                source: patchFilter(spec.source, "job", job),
              });
            }}
            onChangeScorecard={(nextScorecard) => {
              // Patch the whole scorecard block. Also derives the
              // outer `kind` from the components (auto if all-AUTO,
              // hybrid if any MANUAL) so the validator's
              // SCORECARD↔kind cross-check stays satisfied without
              // the editor having to thread `kind` separately.
              const anyManual = (nextScorecard?.components || []).some(
                (c) => c.kind === "manual",
              );
              updatePendingSpec(goalId, {
                scorecard: nextScorecard,
                kind: anyManual ? "hybrid" : "auto",
              });
            }}
          />
        ))}

        {failed.length > 0 ? (
          <FailedStrip failed={failed} goalsById={goalsById} onRetry={onRetryGoal} />
        ) : null}
      </div>
    </div>
  );
}

function BulkStrip({
  pendingCount,
  failedCount,
  bulkError,
  onSaveAll,
  onDiscardAll,
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "16px 20px",
      }}
    >
      <div className="flex items-baseline gap-3">
        <span
          className="font-black"
          style={{
            fontFamily: "var(--font-dot)",
            fontWeight: 900,
            fontSize: 38,
            lineHeight: 0.8,
            letterSpacing: "0.5px",
            color: "var(--fg)",
          }}
        >
          {pendingCount}
        </span>
        <span
          className="uppercase tracking-[0.6px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--muted-fg)",
          }}
        >
          to review
          {failedCount > 0 ? ` · ${failedCount} failed` : ""}
        </span>
      </div>

      {bulkError ? (
        <div
          className="max-w-[420px] truncate"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--bad)",
          }}
          title={bulkError}
        >
          {bulkError}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscardAll}
          disabled={pendingCount === 0}
          className="rounded-[var(--radius-sub)] px-3 py-1.5 uppercase transition-colors hover:opacity-90"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.5px",
            color: "var(--fg)",
            background: "transparent",
            border: "1px solid var(--border-strong)",
            opacity: pendingCount === 0 ? 0.4 : 1,
          }}
        >
          Discard all
        </button>
        <button
          type="button"
          onClick={onSaveAll}
          disabled={pendingCount === 0}
          className="rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.5px",
            background: "var(--accent)",
            color: "var(--accent-on)",
            opacity: pendingCount === 0 ? 0.4 : 1,
          }}
        >
          Save all
        </button>
      </div>
    </div>
  );
}

function PendingCard({
  goalId,
  spec,
  meta,
  repoOptions = [],
  jobOptions = [],
  onSave,
  onSkip,
  onChangeWidget,
  onChangeKind,
  onSetUntrackable,
  onChangeRepo,
  onChangeJob,
  onChangeScorecard,
}) {
  const kindsOk = validKindsFor(spec.widget);
  const widgetMeta = SPEC_KIND_META[spec.widget];
  const isUntrackable = Boolean(spec.untrackable);
  const isScorecard = spec.widget === "SCORECARD";
  const [untrackableDraft, setUntrackableDraft] = useState(
    spec.untrackable?.reason || "",
  );
  const [showUntrackableEditor, setShowUntrackableEditor] = useState(false);

  // Repo / job pickers belong to the top-level source — they're
  // hidden for SCORECARD because the components own their own
  // sources (the editor surfaces them inline per component).
  const sourceProvider = spec.source?.provider;
  const showRepoPicker =
    !isUntrackable &&
    !isScorecard &&
    (sourceProvider === "github" ||
      sourceProvider === "gitlab" ||
      sourceProvider === "combined" ||
      sourceProvider === "github_actions");
  const showJobPicker =
    !isUntrackable && !isScorecard && sourceProvider === "jenkins";
  const currentRepo = spec.source?.filter?.repo || "";
  const currentJob = spec.source?.filter?.job || "";

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        background: isUntrackable
          ? "color-mix(in srgb, var(--warn) 10%, transparent)"
          : "var(--card)",
        border: isUntrackable
          ? "1px solid color-mix(in srgb, var(--warn) 32%, transparent)"
          : "1px solid var(--border)",
        borderRadius: 9,
        padding: "14px 16px",
      }}
    >
      {/* Header: goal title + parent breadcrumb */}
      <div className="flex flex-col gap-0.5">
        {meta?.parentL1 ? (
          <span
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              color: "var(--dim-fg)",
            }}
            title={`Parent L1: ${meta.parentL1}`}
          >
            {truncate(meta.parentL1, 70)} /
          </span>
        ) : null}
        <span
          className="font-semibold"
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.3,
            color: "var(--fg)",
          }}
          title={meta?.title || spec.title}
        >
          {meta?.title || spec.title}
        </span>
      </div>

      {/* Reasoning */}
      {spec.reasoning ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            lineHeight: 1.55,
            color: "var(--muted-fg)",
          }}
        >
          {spec.reasoning}
        </div>
      ) : null}

      {/* Inline edit dropdowns */}
      <div className="flex flex-wrap items-center gap-2">
        <FieldDropdown
          label="widget"
          value={spec.widget}
          onChange={onChangeWidget}
          options={ALL_SPEC_KINDS.map((k) => ({
            value: k,
            label: SPEC_KIND_META[k]?.label || k,
          }))}
        />
        <FieldDropdown
          label="kind"
          value={spec.kind}
          onChange={onChangeKind}
          options={ALL_SPEC_VARIANTS.map((v) => ({
            value: v,
            label: v,
            disabled: !kindsOk.includes(v),
          }))}
        />
        {spec.source?.metric ? (
          <Chip>{spec.source.metric}</Chip>
        ) : null}
        {spec.source?.window ? <Chip>{spec.source.window}</Chip> : null}
        {spec.manual?.cadence ? (
          <Chip>{spec.manual.cadence}</Chip>
        ) : null}
        {spec.delegated ? <Chip tone="warn">delegated</Chip> : null}
        {isUntrackable ? <Chip tone="warn">untrackable</Chip> : null}
        {currentRepo ? <Chip tone="repo">repo · {currentRepo}</Chip> : null}
        {currentJob ? <Chip>job · {currentJob}</Chip> : null}
        {!isUntrackable &&
        widgetMeta?.variant !== spec.kind &&
        !(widgetMeta?.variant === SPEC_VARIANTS.AUTO &&
          spec.kind === SPEC_VARIANTS.HYBRID) ? (
          <Chip tone="danger">kind/variant mismatch</Chip>
        ) : null}
      </div>

      {/* Repo scope picker — only for GitHub / GitLab / combined / GH
          Actions sources. Dropdown when we have repo options from the
          user's merged-PR history (90d); free-text input otherwise so
          it still works when the user hasn't merged anything yet but
          knows their repo name. "All repos" clears the filter. */}
      {showRepoPicker ? (
        <RepoPicker
          value={currentRepo}
          options={repoOptions}
          onChange={onChangeRepo}
        />
      ) : null}

      {/* Jenkins job picker — required for the three CI/CD widgets
          when source.provider === "jenkins". Dropdown when we
          enumerated jobs over the Jenkins API; free-text fallback
          when no jobs returned (Jenkins not connected, restricted
          permissions, or just empty controller). */}
      {showJobPicker ? (
        <JobPicker
          value={currentJob}
          options={jobOptions}
          onChange={onChangeJob}
        />
      ) : null}

      {/* SCORECARD sub-editor — surfaces each component with its own
          widget/kind/weight/target so the user can refine the AI's
          composite guess. Hidden when untrackable so the flag's
          read-only banner takes priority. */}
      {isScorecard && !isUntrackable ? (
        <ScorecardEditor
          scorecard={spec.scorecard}
          repoOptions={repoOptions}
          onChange={onChangeScorecard}
        />
      ) : null}

      {/* Untrackable banner + reason editor — shown when the spec is
          already flagged untrackable (read-only view + clear button)
          OR when the user clicked "Mark untrackable" (editor view). */}
      {isUntrackable ? (
        <div
          className="flex flex-col gap-1.5 rounded-[var(--radius-sub)] px-2.5 py-2"
          style={{
            background: "color-mix(in srgb, var(--warn) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--warn) 32%, transparent)",
          }}
        >
          <div
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              color: "var(--warn)",
            }}
          >
            Marked untrackable
          </div>
          <div
            className="italic"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 10.5,
              lineHeight: 1.5,
              color: "var(--muted-fg)",
            }}
          >
            “{spec.untrackable.reason}”
          </div>
          <button
            type="button"
            onClick={() => {
              setUntrackableDraft("");
              setShowUntrackableEditor(false);
              onSetUntrackable("");
            }}
            className="self-start uppercase transition-colors hover:opacity-90"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.5px",
              color: "var(--dim-fg)",
            }}
          >
            unflag · make trackable
          </button>
        </div>
      ) : showUntrackableEditor ? (
        <div
          className="flex flex-col gap-1.5 rounded-[var(--radius-sub)] px-2.5 py-2"
          style={{
            background: "color-mix(in srgb, var(--warn) 8%, transparent)",
            border: "1px dashed color-mix(in srgb, var(--warn) 32%, transparent)",
          }}
        >
          <label
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--dim-fg)",
            }}
          >
            Reason
          </label>
          <textarea
            value={untrackableDraft}
            onChange={(e) => setUntrackableDraft(e.target.value)}
            placeholder="e.g. needs a quarterly survey we haven't set up yet"
            rows={2}
            className="w-full p-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--fg)",
              background: "var(--field)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sub)",
              resize: "vertical",
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setUntrackableDraft("");
                setShowUntrackableEditor(false);
              }}
              className="uppercase transition-colors hover:opacity-90"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.5px",
                color: "var(--dim-fg)",
              }}
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const trimmed = untrackableDraft.trim();
                if (!trimmed) return;
                onSetUntrackable(trimmed);
                setShowUntrackableEditor(false);
              }}
              disabled={!untrackableDraft.trim()}
              className="rounded-[var(--radius-sub)] px-2 py-1 font-bold uppercase"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                letterSpacing: "0.4px",
                background: "var(--accent)",
                color: "var(--accent-on)",
                opacity: untrackableDraft.trim() ? 1 : 0.4,
              }}
            >
              Mark untrackable
            </button>
          </div>
        </div>
      ) : null}

      {/* Action row */}
      <div className="mt-1 flex items-center justify-end gap-2">
        {!isUntrackable && !showUntrackableEditor ? (
          <button
            type="button"
            onClick={() => setShowUntrackableEditor(true)}
            className="mr-auto uppercase transition-colors hover:opacity-90"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.5px",
              color: "var(--dim-fg)",
            }}
            title="Mark this goal as not currently trackable, with a reason"
          >
            can't track this →
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSkip}
          className="rounded-[var(--radius-sub)] px-2.5 py-1 uppercase transition-colors hover:opacity-90"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.4px",
            color: "var(--muted-fg)",
            background: "transparent",
            border: "1px solid var(--border-strong)",
          }}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-[var(--radius-sub)] px-2.5 py-1 font-bold uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.4px",
            background: "var(--accent)",
            color: "var(--accent-on)",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function FieldDropdown({ label, value, onChange, options }) {
  return (
    <label
      className="inline-flex items-center gap-1.5 px-2.5 py-1"
      style={{
        background: "var(--field)",
        border: "1px solid var(--border-strong)",
        borderRadius: 5,
      }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--dim-fg)",
        }}
      >
        {label}
      </span>
      <Select
        tone="default"
        size="sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingLeft: 0 }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
            {opt.disabled ? " (incompatible)" : ""}
          </option>
        ))}
      </Select>
    </label>
  );
}

function Chip({ children, tone }) {
  const style =
    tone === "warn"
      ? {
          background: "color-mix(in srgb, var(--warn) 18%, transparent)",
          color: "var(--warn)",
        }
      : tone === "danger"
        ? {
            background: "color-mix(in srgb, var(--bad) 18%, transparent)",
            color: "var(--bad)",
          }
        : tone === "repo"
          ? { background: "var(--accent-dim)", color: "var(--accent)" }
          : { background: "var(--panel-2)", color: "var(--muted-fg)" };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] font-semibold uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: "0.4px",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function FailedStrip({ failed, goalsById, onRetry }) {
  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded-[var(--radius-tile)] px-3.5 py-3"
      style={{
        background: "color-mix(in srgb, var(--bad) 8%, transparent)",
        border: "1px dashed color-mix(in srgb, var(--bad) 32%, transparent)",
      }}
    >
      <div
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--bad)",
        }}
      >
        Failed to classify ({failed.length})
      </div>
      {failed.map((f) => (
        <div
          key={f.goalId}
          className="flex items-center justify-between gap-2"
        >
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-semibold"
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: 13,
                color: "var(--fg)",
              }}
            >
              {goalsById.get(f.goalId)?.title || f.goalId}
            </div>
            <div
              className="truncate"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--muted-fg)",
              }}
              title={f.error}
            >
              {f.error}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRetry?.(f.goalId)}
            className="rounded-[var(--radius-sub)] px-2.5 py-1 uppercase transition-colors hover:opacity-90"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.4px",
              color: "var(--fg)",
              background: "transparent",
              border: "1px solid var(--border-strong)",
            }}
          >
            Retry ↻
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyPlaceholder({ onSwitchToGrid }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-tile)] p-8 text-center"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--muted-fg)",
        border: "1px dashed var(--border)",
      }}
    >
      Nothing pending review.
      <button
        type="button"
        onClick={onSwitchToGrid}
        className="rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.5px",
          background: "var(--accent)",
          color: "var(--accent-on)",
        }}
      >
        Go to widgets →
      </button>
    </div>
  );
}

/** Build a lookup of goal metadata from the GOAL_STARTED event payloads. */
function indexGoalMetaFromEvents(events) {
  const byId = new Map();
  for (const evt of events) {
    if (evt.type === ANALYSIS.GOAL_STARTED) {
      byId.set(evt.payload.goalId, {
        title: evt.payload.title,
        parentL1: evt.payload.parentL1,
      });
    }
  }
  return byId;
}

/** Pull goal-failed events whose goalId isn't in pendingSpecs. */
function extractFailures(events, pendingSpecs) {
  const out = [];
  for (const evt of events) {
    if (evt.type === ANALYSIS.GOAL_FAILED) {
      if (!pendingSpecs[evt.payload.goalId]) {
        out.push({ goalId: evt.payload.goalId, error: evt.payload.error });
      }
    }
  }
  return out;
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}
