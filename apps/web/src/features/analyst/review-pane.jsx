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
 */

import { useMemo, useState } from "react";
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
 * Apply a `source.filter[key]` change to a spec.source, returning the
 * new source object (or null when filter would become empty). Null /
 * empty value deletes the key; a non-empty value sets it.
 *
 * Centralises the same delete/restore dance both repo + job pickers
 * need so the call sites stay one-liners.
 */
function patchFilter(source, key, value) {
  if (!source) return null;
  if (!value) {
    if (!source.filter) return source;
    const next = { ...source.filter };
    delete next[key];
    return {
      ...source,
      filter: Object.keys(next).length > 0 ? next : null,
    };
  }
  return {
    ...source,
    filter: { ...(source.filter || {}), [key]: value },
  };
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
              updatePendingSpec(goalId, { widget, kind: nextKind });
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
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-tile)] px-4 py-3"
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}
    >
      <div className="flex items-baseline gap-3">
        <span
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            letterSpacing: "-0.4px",
          }}
        >
          {pendingCount}
        </span>
        <span
          className="uppercase tracking-[0.6px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "rgba(255,255,255,0.75)",
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
            color: "#fca5a5",
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
          className="rounded-[var(--radius-sub)] px-3 py-1.5 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.5px",
            color: "rgba(255,255,255,0.9)",
            border: "1px solid rgba(255,255,255,0.2)",
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
            background: "#ffffff",
            color: "var(--accent)",
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
}) {
  const kindsOk = validKindsFor(spec.widget);
  const widgetMeta = SPEC_KIND_META[spec.widget];
  const isUntrackable = Boolean(spec.untrackable);
  const [untrackableDraft, setUntrackableDraft] = useState(
    spec.untrackable?.reason || "",
  );
  const [showUntrackableEditor, setShowUntrackableEditor] = useState(false);

  // Repo picker covers GitHub/GitLab MR-based widgets AND the GitHub
  // Actions provider (which also scopes by `owner/name` repo slug).
  // Jenkins gets its own picker (jobs, not repos).
  const sourceProvider = spec.source?.provider;
  const showRepoPicker =
    !isUntrackable &&
    (sourceProvider === "github" ||
      sourceProvider === "gitlab" ||
      sourceProvider === "combined" ||
      sourceProvider === "github_actions");
  const showJobPicker = !isUntrackable && sourceProvider === "jenkins";
  const currentRepo = spec.source?.filter?.repo || "";
  const currentJob = spec.source?.filter?.job || "";

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-tile)] px-3.5 py-3"
      style={{
        background: isUntrackable
          ? "rgba(255,193,87,0.08)"
          : "rgba(255,255,255,0.06)",
        border: isUntrackable
          ? "1px solid rgba(255,193,87,0.3)"
          : "1px solid rgba(255,255,255,0.14)",
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
              color: "rgba(255,255,255,0.6)",
            }}
            title={`Parent L1: ${meta.parentL1}`}
          >
            {truncate(meta.parentL1, 70)} /
          </span>
        ) : null}
        <span
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            letterSpacing: "-0.2px",
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
            color: "rgba(255,255,255,0.78)",
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
        {currentRepo ? <Chip>repo · {currentRepo}</Chip> : null}
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

      {/* Untrackable banner + reason editor — shown when the spec is
          already flagged untrackable (read-only view + clear button)
          OR when the user clicked "Mark untrackable" (editor view). */}
      {isUntrackable ? (
        <div
          className="flex flex-col gap-1.5 rounded-[var(--radius-sub)] px-2.5 py-2"
          style={{
            background: "rgba(255,193,87,0.10)",
            border: "1px solid rgba(255,193,87,0.28)",
          }}
        >
          <div
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              color: "#fde68a",
            }}
          >
            Marked untrackable
          </div>
          <div
            className="italic"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.85)",
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
              color: "rgba(255,255,255,0.7)",
            }}
          >
            unflag · make trackable
          </button>
        </div>
      ) : showUntrackableEditor ? (
        <div
          className="flex flex-col gap-1.5 rounded-[var(--radius-sub)] px-2.5 py-2"
          style={{
            background: "rgba(255,193,87,0.06)",
            border: "1px dashed rgba(255,193,87,0.28)",
          }}
        >
          <label
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "rgba(255,255,255,0.6)",
            }}
          >
            Reason
          </label>
          <textarea
            value={untrackableDraft}
            onChange={(e) => setUntrackableDraft(e.target.value)}
            placeholder="e.g. needs a quarterly survey we haven't set up yet"
            rows={2}
            className="w-full rounded-[var(--radius-sub)] bg-transparent p-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "rgba(255,255,255,0.95)",
              border: "1px solid rgba(255,255,255,0.18)",
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
                color: "rgba(255,255,255,0.7)",
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
                background: "rgba(255,255,255,0.92)",
                color: "var(--accent)",
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
              color: "rgba(255,255,255,0.55)",
            }}
            title="Mark this goal as not currently trackable, with a reason"
          >
            can't track this →
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSkip}
          className="rounded-[var(--radius-sub)] px-2.5 py-1 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.4px",
            color: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(255,255,255,0.18)",
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
            background: "rgba(255,255,255,0.92)",
            color: "var(--accent)",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * Repo scope chip. Dropdown when we discovered repo names from the
 * user's merged-PR history; free-text input otherwise so the field is
 * never useless. "All repos" is always the first dropdown option and
 * maps to null on the spec (clears the filter).
 */
function RepoPicker({ value, options, onChange }) {
  const hasOptions = options.length > 0;
  // When the current value isn't in the discovered list (e.g. user
  // typed something the API hasn't seen yet) keep showing it so the
  // selection isn't quietly dropped.
  const allOptions = useMemo(() => {
    const out = [...options];
    if (value && !out.includes(value)) out.unshift(value);
    return out;
  }, [options, value]);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sub)] px-2.5 py-1.5"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.14)",
      }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "rgba(255,255,255,0.55)",
        }}
      >
        Repo scope
      </span>
      {hasOptions ? (
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="cursor-pointer bg-transparent outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "rgba(255,255,255,0.95)",
          }}
        >
          <option value="" style={{ color: "#000" }}>
            All repos
          </option>
          {allOptions.map((slug) => (
            <option key={slug} value={slug} style={{ color: "#000" }}>
              {slug}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          placeholder="owner/name (leave empty for all)"
          className="flex-1 bg-transparent outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "rgba(255,255,255,0.95)",
            minWidth: 200,
          }}
        />
      )}
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="uppercase transition-colors hover:opacity-90"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.5px",
            color: "rgba(255,255,255,0.55)",
          }}
          title="Drop the repo filter — count merges across every connected repo."
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

/**
 * Jenkins job picker — required for the three CI/CD AUTO widgets
 * when `source.provider === "jenkins"`. Same UX skeleton as
 * RepoPicker but labelled "Job scope" and gated on Jenkins-shaped
 * options (no "all jobs" fallback — Jenkins specs MUST pick one
 * job).
 *
 * Unlike RepoPicker, the empty value still appears as `clear` but
 * the widget will render NeedsScopeBanner when no job is set. This
 * is deliberate — the user can save the spec partially, then come
 * back later when they know which job to wire it to.
 */
function JobPicker({ value, options, onChange }) {
  const hasOptions = options.length > 0;
  const allOptions = useMemo(() => {
    const out = [...options];
    if (value && !out.includes(value)) out.unshift(value);
    return out;
  }, [options, value]);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sub)] px-2.5 py-1.5"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.14)",
      }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "rgba(255,255,255,0.55)",
        }}
      >
        Job scope
      </span>
      {hasOptions ? (
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="cursor-pointer bg-transparent outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "rgba(255,255,255,0.95)",
          }}
        >
          <option value="" style={{ color: "#000" }}>
            (pick a job)
          </option>
          {allOptions.map((slug) => (
            <option key={slug} value={slug} style={{ color: "#000" }}>
              {slug}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          placeholder="job-name"
          className="flex-1 bg-transparent outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "rgba(255,255,255,0.95)",
            minWidth: 200,
          }}
        />
      )}
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="uppercase transition-colors hover:opacity-90"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            letterSpacing: "0.5px",
            color: "rgba(255,255,255,0.55)",
          }}
          title="Drop the job filter — widget will show 'needs scope' until you pick a job."
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

function FieldDropdown({ label, value, onChange, options }) {
  return (
    <label
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
      style={{
        background: "rgba(255,255,255,0.1)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}
    >
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent outline-none"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "rgba(255,255,255,0.95)",
        }}
      >
        {options.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            style={{ color: "#000" }}
          >
            {opt.label}
            {opt.disabled ? " (incompatible)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function Chip({ children, tone }) {
  const style =
    tone === "warn"
      ? { background: "rgba(255,193,87,0.22)", color: "#fde68a" }
      : tone === "danger"
        ? { background: "rgba(239,68,68,0.22)", color: "#fecaca" }
        : {
            background: "rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.85)",
          };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] font-semibold uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
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
        background: "rgba(239,68,68,0.10)",
        border: "1px solid rgba(239,68,68,0.32)",
      }}
    >
      <div
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "#fecaca",
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
              style={{ fontFamily: "var(--font-display)", fontSize: 13 }}
            >
              {goalsById.get(f.goalId)?.title || f.goalId}
            </div>
            <div
              className="truncate"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "rgba(255,255,255,0.72)",
              }}
              title={f.error}
            >
              {f.error}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onRetry?.(f.goalId)}
            className="rounded-[var(--radius-sub)] px-2.5 py-1 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.4px",
              color: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            Retry
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
        color: "rgba(255,255,255,0.7)",
        border: "1px dashed rgba(255,255,255,0.2)",
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
          background: "#ffffff",
          color: "var(--accent)",
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
