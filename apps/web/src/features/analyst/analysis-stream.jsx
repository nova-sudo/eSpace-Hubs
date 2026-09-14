"use client";

import { useEffect, useMemo, useRef } from "react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ANALYSIS } from "./ai/analysis-events";
import { SPEC_KIND_META } from "@/features/goal-specs";

/**
 * Streaming log of AnalysisEvents — the "process reveal" UX.
 *
 * Folds the flat event list into a per-goal view:
 *   - started at ts
 *   - accumulated reasoning chunks
 *   - terminal state: classified | failed
 *
 * Autoscrolls as new events arrive and renders a summary header ("X/Y
 * classified · N widgets live") at the top so the user always sees the
 * run's overall progress without having to scroll.
 */
export function AnalysisStream({ events, phase, error, onSwitchToGrid }) {
  const scrollerRef = useRef(null);

  const { summary, goalBlocks, startedAt } = useMemo(
    () => foldEvents(events),
    [events],
  );

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SummaryStrip
        summary={summary}
        phase={phase}
        error={error}
        startedAt={startedAt}
        onSwitchToGrid={onSwitchToGrid}
      />
      <div ref={scrollerRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {goalBlocks.length === 0 ? (
          <EmptyPlaceholder />
        ) : (
          goalBlocks.map((block, i) => (
            <GoalBlock key={block.goalId} block={block} first={i === 0} />
          ))
        )}
      </div>
    </div>
  );
}
function foldEvents(events) {
  let totalGoals = 0;
  let startedAt = null;
  const blocks = new Map();

  for (const evt of events) {
    if (evt.type === ANALYSIS.START) {
      totalGoals = evt.payload?.totalGoals || 0;
      startedAt = evt.payload?.startedAt || Date.now();
    } else if (evt.type === ANALYSIS.GOAL_STARTED) {
      blocks.set(evt.payload.goalId, {
        goalId: evt.payload.goalId,
        title: evt.payload.title,
        parentL1: evt.payload.parentL1,
        reasoning: "",
        state: "reading",
        spec: null,
        error: null,
        startedAt: Date.now(),
      });
    } else if (evt.type === ANALYSIS.GOAL_REASONING) {
      const b = blocks.get(evt.payload.goalId);
      if (b) {
        b.reasoning += evt.payload.chunk || "";
        b.state = "reasoning";
      }
    } else if (evt.type === ANALYSIS.GOAL_CLASSIFIED) {
      const b = blocks.get(evt.payload.goalId);
      if (b) {
        b.state = "classified";
        b.spec = evt.payload.spec;
      }
    } else if (evt.type === ANALYSIS.GOAL_FAILED) {
      const b = blocks.get(evt.payload.goalId);
      if (b) {
        b.state = "failed";
        b.error = evt.payload.error;
      }
    }
  }

  const goalBlocks = [...blocks.values()];
  const classified = goalBlocks.filter((b) => b.state === "classified").length;
  const failed = goalBlocks.filter((b) => b.state === "failed").length;
  const summary = { totalGoals, classified, failed, inFlight: goalBlocks.length };

  return { summary, goalBlocks, startedAt };
}

function SummaryStrip({ summary, phase, error, startedAt, onSwitchToGrid }) {
  const elapsed = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  const elapsedSec = Math.floor(elapsed / 1000);
  const phaseLabel =
    phase === "running"
      ? "Analyzing goals"
      : phase === "complete"
        ? "Complete"
        : phase === "error"
          ? "Error"
          : "Idle";
  const phaseTone =
    phase === "running" ? "lemon" : phase === "complete" ? "mint" : phase === "error" ? "peach" : "neutral";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div className="flex items-baseline gap-3">
        <span className="text-[38px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
          {summary.classified}
          <span className="text-dim-fg">
            {summary.totalGoals > 0 ? ` / ${summary.totalGoals}` : ""}
          </span>
        </span>
        <Badge tone={phaseTone}>
          {phaseLabel}
          {phase === "running" ? ` · ${elapsedSec}s` : ""}
          {summary.failed > 0 ? ` · ${summary.failed} failed` : ""}
        </Badge>
      </div>
      {error ? (
        <div className="max-w-[420px] truncate text-[13px] text-peach-ink" title={error}>
          {error}
        </div>
      ) : null}
      {phase === "complete" && summary.classified > 0 ? (
        <Button variant="ink" size="sm" onClick={onSwitchToGrid}>
          View widgets
        </Button>
      ) : null}
    </div>
  );
}

function GoalBlock({ block, first }) {
  const meta = block.spec ? SPEC_KIND_META[block.spec.widget] : null;
  const dotClass =
    block.state === "classified"
      ? "bg-mint-ink"
      : block.state === "failed"
        ? "bg-peach-ink"
        : block.state === "reasoning" || block.state === "reading"
          ? "bg-lemon-ink"
          : "bg-dim-fg";

  return (
    <div className={cn("flex flex-col gap-2 py-4", !first && "border-t border-line")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span aria-hidden="true" className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
          {block.parentL1 ? (
            <span
              className="truncate font-mono text-[12px] text-dim-fg"
              title={`Parent L1: ${block.parentL1}`}
            >
              {truncate(block.parentL1, 38)} /
            </span>
          ) : null}
          <span className="truncate text-[13px] font-bold text-fg" title={block.title}>
            {truncate(block.title, 84)}
          </span>
        </div>
        <StatusBadge state={block.state} widgetLabel={meta?.label} />
      </div>
      {block.reasoning ? (
        <div
          className="pl-3.5 text-[13px] leading-[1.55] text-muted-fg"
          style={{
            maxHeight: block.state === "classified" ? 120 : undefined,
            overflowY: block.state === "classified" ? "auto" : undefined,
          }}
        >
          {block.state === "reasoning" ? (
            <>
              {block.reasoning}
              <StreamCaret />
            </>
          ) : (
            stripJsonFences(block.reasoning)
          )}
        </div>
      ) : null}
      {block.spec?.reasoning ? (
        <div className="ml-3.5 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2 text-[12px] leading-[1.5] text-muted-fg">
          <span className="font-bold text-dim-fg">Why · </span>
          {block.spec.reasoning}
        </div>
      ) : null}
      {block.error ? (
        <div className="pl-3.5 text-[13px] text-peach-ink">Failed: {block.error}</div>
      ) : null}
    </div>
  );
}

/** Blinking text-input caret shown while reasoning is still streaming in. */
function StreamCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-[14px] w-[2px] shrink-0 translate-y-[3px] animate-pulse bg-ink align-middle"
    />
  );
}

function StatusBadge({ state, widgetLabel }) {
  if (state === "classified") return <Badge tone="mint">{widgetLabel || "Classified"}</Badge>;
  if (state === "failed") return <Badge tone="peach">Failed</Badge>;
  if (state === "reading") return <Badge tone="neutral">Reading…</Badge>;
  return <Badge tone="lemon">Classifying…</Badge>;
}

function EmptyPlaceholder() {
  return (
    <div className="flex flex-1 items-center justify-center rounded-[var(--radius-lg)] bg-card-alt p-6 text-center text-[13px] text-dim-fg">
      Warming up the analyst — hang tight.
    </div>
  );
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function stripJsonFences(text) {
  // If the model leaked raw JSON into the prose (which happens when JSON
  // mode emits the object as chunks), trim obvious wrapping braces so the
  // reader doesn't see a noisy dump.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return `(classification payload · ${trimmed.length} chars)`;
  }
  return text;
}
