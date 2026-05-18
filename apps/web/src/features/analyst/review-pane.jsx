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
  onSave,
  onSkip,
  onChangeWidget,
  onChangeKind,
}) {
  const kindsOk = validKindsFor(spec.widget);
  const widgetMeta = SPEC_KIND_META[spec.widget];

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--radius-tile)] px-3.5 py-3"
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.14)",
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
        {widgetMeta?.variant !== spec.kind &&
        !(widgetMeta?.variant === SPEC_VARIANTS.AUTO &&
          spec.kind === SPEC_VARIANTS.HYBRID) ? (
          <Chip tone="danger">kind/variant mismatch</Chip>
        ) : null}
      </div>

      {/* Action row */}
      <div className="mt-1 flex items-center justify-end gap-2">
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
