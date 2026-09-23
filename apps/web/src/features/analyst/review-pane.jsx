"use client";

/**
 * Review pane — shown after classification completes, before any spec
 * is committed to the goal-specs store.
 *
 * Each pending spec is rendered as a white card with:
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
import { Button, Badge, Card, Field, Label, Select } from "@/components/ui";
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
  useLabelOptions,
} from "@/features/integrations";
import { isoDaysAgo } from "@/lib/date";
import { ANALYSIS } from "./ai/analysis-events";
import {
  ScorecardEditor,
  RepoPicker,
  JobPicker,
  patchFilter,
  LabelsPicker,
  isLabelWidget,
  patchLabels,
  TicketTypePicker,
  useTicketTypeOptions,
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
  const { options: labelOptions } = useLabelOptions();
  const ticketTypeOptions = useTicketTypeOptions();
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
            labelOptions={labelOptions}
            ticketTypeOptions={ticketTypeOptions}
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
            onChangeLabels={(labels, mode) => {
              updatePendingSpec(goalId, {
                source: patchLabels(spec.source, labels, mode),
              });
            }}
            onChangeTicketType={(ticketType) => {
              updatePendingSpec(goalId, {
                source: patchFilter(spec.source, "ticketType", ticketType),
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div className="flex items-baseline gap-3">
        <span className="text-[38px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
          {pendingCount}
        </span>
        <Badge tone={failedCount > 0 ? "peach" : "neutral"}>
          To review{failedCount > 0 ? ` · ${failedCount} failed` : ""}
        </Badge>
      </div>

      {bulkError ? (
        <div className="max-w-[420px] truncate text-[13px] text-peach-ink" title={bulkError}>
          {bulkError}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button variant="danger" size="sm" onClick={onDiscardAll} disabled={pendingCount === 0}>
          Discard all
        </Button>
        <Button variant="ink" size="sm" onClick={onSaveAll} disabled={pendingCount === 0}>
          Save all
        </Button>
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
  labelOptions = [],
  ticketTypeOptions = [],
  onSave,
  onSkip,
  onChangeWidget,
  onChangeKind,
  onSetUntrackable,
  onChangeRepo,
  onChangeJob,
  onChangeLabels,
  onChangeTicketType,
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
  const showLabelsPicker =
    !isUntrackable && !isScorecard && Boolean(spec.source) && isLabelWidget(spec.widget);
  const currentLabels = Array.isArray(spec.source?.labels) ? spec.source.labels : [];
  const showTicketTypePicker =
    !isUntrackable && !isScorecard && Boolean(spec.source) && spec.widget === "TICKET_TYPE_SHARE";
  const currentTicketType = spec.source?.filter?.ticketType || "";
  const kindMismatch =
    !isUntrackable &&
    widgetMeta?.variant !== spec.kind &&
    !(widgetMeta?.variant === SPEC_VARIANTS.AUTO && spec.kind === SPEC_VARIANTS.HYBRID);

  return (
    <Card padding={16} className="flex flex-col gap-3">
      {/* Header: widget kind label, goal title + parent breadcrumb, status */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label>{widgetMeta?.label || spec.widget}</Label>
          {meta?.parentL1 ? (
            <span className="truncate text-[12px] text-dim-fg" title={`Parent L1: ${meta.parentL1}`}>
              {truncate(meta.parentL1, 70)}
            </span>
          ) : null}
          <span className="text-[15px] font-bold leading-[1.3] text-fg" title={meta?.title || spec.title}>
            {meta?.title || spec.title}
          </span>
        </div>
        <Badge tone="lemon">Pending review</Badge>
      </div>

      {/* Reasoning */}
      {spec.reasoning ? (
        <div className="text-[13px] leading-[1.55] text-muted-fg">{spec.reasoning}</div>
      ) : null}

      {/* Inline edit dropdowns */}
      <div className="flex flex-wrap items-center gap-2">
        <FieldDropdown
          label="Widget"
          value={spec.widget}
          onChange={onChangeWidget}
          options={ALL_SPEC_KINDS.map((k) => ({
            value: k,
            label: SPEC_KIND_META[k]?.label || k,
          }))}
        />
        <FieldDropdown
          label="Kind"
          value={spec.kind}
          onChange={onChangeKind}
          options={ALL_SPEC_VARIANTS.map((v) => ({
            value: v,
            label: v,
            disabled: !kindsOk.includes(v),
          }))}
        />
        {spec.source?.metric ? <Badge>{spec.source.metric}</Badge> : null}
        {spec.source?.window ? <Badge>{spec.source.window}</Badge> : null}
        {spec.manual?.cadence ? <Badge>{spec.manual.cadence}</Badge> : null}
        {spec.delegated ? <Badge tone="lemon">Delegated</Badge> : null}
        {isUntrackable ? <Badge tone="lemon">Untrackable</Badge> : null}
        {currentRepo ? <Badge tone="lav">Repo · {currentRepo}</Badge> : null}
        {currentJob ? <Badge>Job · {currentJob}</Badge> : null}
        {currentLabels.length ? <Badge tone="lav">Labels · {currentLabels.join(", ")}</Badge> : null}
        {currentTicketType ? <Badge tone="lav">Ticket · {currentTicketType}</Badge> : null}
        {kindMismatch ? <Badge tone="peach">Kind/variant mismatch</Badge> : null}
      </div>

      {/* Repo scope picker — only for GitHub / GitLab / combined / GH
          Actions sources. Dropdown when we have repo options from the
          user's merged-PR history (90d); free-text input otherwise so
          it still works when the user hasn't merged anything yet but
          knows their repo name. "All repos" clears the filter. */}
      {showRepoPicker ? (
        <RepoPicker value={currentRepo} options={repoOptions} onChange={onChangeRepo} />
      ) : null}

      {/* Jenkins job picker — required for the three CI/CD widgets
          when source.provider === "jenkins". Dropdown when we
          enumerated jobs over the Jenkins API; free-text fallback
          when no jobs returned (Jenkins not connected, restricted
          permissions, or just empty controller). */}
      {showJobPicker ? (
        <JobPicker value={currentJob} options={jobOptions} onChange={onChangeJob} />
      ) : null}

      {/* Label picker — LABEL_SHARE / ASSISTED_SHARE only. Options are the
          labels seen on the user's merged PRs this year, so the list is
          also the answer to "what could I track with a label?". */}
      {showLabelsPicker ? (
        <LabelsPicker
          value={currentLabels}
          mode={spec.source?.labelMode}
          options={labelOptions}
          assisted={spec.widget === "ASSISTED_SHARE"}
          onChange={(labels) => onChangeLabels(labels, undefined)}
          onChangeMode={(mode) => onChangeLabels(undefined, mode)}
        />
      ) : null}

      {/* Ticket-type picker — TICKET_TYPE_SHARE only. Options are the
          issue types on the user's own Jira queue. */}
      {showTicketTypePicker ? (
        <TicketTypePicker
          value={currentTicketType || null}
          mode={spec.source?.labelMode}
          options={ticketTypeOptions}
          onChange={onChangeTicketType}
          onChangeMode={(mode) => onChangeLabels(undefined, mode)}
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
        <div className="flex flex-col gap-1.5 rounded-[var(--radius-lg)] bg-lemon px-3.5 py-3 text-lemon-ink">
          <div className="text-[12px] font-semibold">Marked untrackable</div>
          <div className="text-[13px] italic">“{spec.untrackable.reason}”</div>
          <button
            type="button"
            onClick={() => {
              setUntrackableDraft("");
              setShowUntrackableEditor(false);
              onSetUntrackable("");
            }}
            className="self-start text-[12px] font-bold"
          >
            Unflag — make trackable
          </button>
        </div>
      ) : showUntrackableEditor ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-card-alt p-3.5">
          <Field label="Reason">
            <textarea
              value={untrackableDraft}
              onChange={(e) => setUntrackableDraft(e.target.value)}
              placeholder="e.g. needs a quarterly survey we haven't set up yet"
              rows={2}
              className="w-full resize-y rounded-[var(--radius-md)] bg-card px-2.5 py-2 text-[13px] text-fg outline-none focus:ring-2 focus:ring-ink"
            />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setUntrackableDraft("");
                setShowUntrackableEditor(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="ink"
              size="sm"
              disabled={!untrackableDraft.trim()}
              onClick={() => {
                const trimmed = untrackableDraft.trim();
                if (!trimmed) return;
                onSetUntrackable(trimmed);
                setShowUntrackableEditor(false);
              }}
            >
              Mark untrackable
            </Button>
          </div>
        </div>
      ) : null}

      {/* Action row */}
      <div className="mt-1 flex items-center justify-end gap-2">
        {!isUntrackable && !showUntrackableEditor ? (
          <Button
            variant="soft"
            size="sm"
            className="mr-auto"
            onClick={() => setShowUntrackableEditor(true)}
            title="Mark this goal as not currently trackable, with a reason"
          >
            Can't track this
          </Button>
        ) : null}
        <Button variant="danger" size="sm" onClick={onSkip}>
          Skip
        </Button>
        <Button variant="ink" size="sm" onClick={onSave}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function FieldDropdown({ label, value, onChange, options }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-card-alt px-2.5 py-1.5">
      <Label>{label}</Label>
      <Select tone="bare" size="sm" value={value} onChange={(e) => onChange(e.target.value)}>
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

function FailedStrip({ failed, goalsById, onRetry }) {
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-peach px-3.5 py-3 text-peach-ink">
      <span className="text-[12px] font-semibold">Failed to classify ({failed.length})</span>
      {failed.map((f) => (
        <div key={f.goalId} className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold">
              {goalsById.get(f.goalId)?.title || f.goalId}
            </div>
            <div className="truncate text-[12px] opacity-80" title={f.error}>
              {f.error}
            </div>
          </div>
          <Button variant="soft" size="sm" onClick={() => onRetry?.(f.goalId)}>
            Retry
          </Button>
        </div>
      ))}
    </div>
  );
}

function EmptyPlaceholder({ onSwitchToGrid }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] bg-card-alt p-8 text-center text-[13px] text-muted-fg">
      Nothing pending review.
      <Button variant="ink" size="sm" onClick={onSwitchToGrid}>
        Go to widgets
      </Button>
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
