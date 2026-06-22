"use client";

import { useEffect, useMemo, useRef } from "react";
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SummaryStrip
        summary={summary}
        phase={phase}
        error={error}
        startedAt={startedAt}
        onSwitchToGrid={onSwitchToGrid}
      />
      <div
        ref={scrollerRef}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1"
      >
        {goalBlocks.length === 0 ? (
          <EmptyPlaceholder />
        ) : (
          goalBlocks.map((block) => (
            <GoalBlock key={block.goalId} block={block} />
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
            color: "var(--fg)",
          }}
        >
          {summary.classified}
          <span style={{ color: "var(--dim-fg)" }}>
            {summary.totalGoals > 0 ? ` / ${summary.totalGoals}` : ""}
          </span>
        </span>
        <span
          className="uppercase tracking-[0.6px]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--muted-fg)",
          }}
        >
          {phase === "running" ? "analyzing goals" : phase === "complete" ? "complete" : phase === "error" ? "error" : "idle"}
          {phase === "running" ? ` · ${elapsedSec}s` : ""}
          {summary.failed > 0 ? ` · ${summary.failed} failed` : ""}
        </span>
      </div>
      {error ? (
        <div
          className="max-w-[420px] truncate"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--bad)",
          }}
          title={error}
        >
          {error}
        </div>
      ) : null}
      {phase === "complete" && summary.classified > 0 ? (
        <button
          type="button"
          onClick={onSwitchToGrid}
          className="font-bold uppercase transition-colors"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            letterSpacing: "0.4px",
            background: "var(--accent)",
            color: "var(--accent-on)",
            borderRadius: 6,
            padding: "9px 15px",
          }}
        >
          View widgets →
        </button>
      ) : null}
    </div>
  );
}

function GoalBlock({ block }) {
  const meta = block.spec ? SPEC_KIND_META[block.spec.widget] : null;

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 9,
        padding: "13px 15px",
        animation: "analystBlockIn 220ms ease-out",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          {block.parentL1 ? (
            <span
              className="uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                color: "var(--dim-fg)",
              }}
              title={`Parent L1: ${block.parentL1}`}
            >
              {truncate(block.parentL1, 38)} /
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
            title={block.title}
          >
            {truncate(block.title, 84)}
          </span>
        </div>
        <StatusChip state={block.state} widgetLabel={meta?.label} />
      </div>
      {block.reasoning ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            lineHeight: 1.55,
            color: "var(--muted-fg)",
            maxHeight: block.state === "classified" ? 120 : undefined,
            overflowY: block.state === "classified" ? "auto" : undefined,
          }}
        >
          {block.state === "reasoning" ? (
            <>
              {block.reasoning}
              <i className="glyph-cursor" />
            </>
          ) : (
            stripJsonFences(block.reasoning)
          )}
        </div>
      ) : null}
      {block.spec?.reasoning ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            lineHeight: 1.5,
            color: "var(--muted-fg)",
            background: "var(--panel-2)",
            padding: "8px 10px",
            borderRadius: 5,
          }}
        >
          <strong
            className="uppercase tracking-[0.5px]"
            style={{ fontSize: 9, color: "var(--dim-fg)" }}
          >
            why ·
          </strong>{" "}
          {block.spec.reasoning}
        </div>
      ) : null}
      {block.error ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--bad)",
          }}
        >
          failed: {block.error}
        </div>
      ) : null}
      <style>{`
        @keyframes analystBlockIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function StatusChip({ state, widgetLabel }) {
  if (state === "classified") {
    return (
      <Chip
        style={{
          color: "var(--good)",
          background: "color-mix(in srgb, var(--good) 18%, transparent)",
        }}
      >
        ✓ {widgetLabel || "classified"}
      </Chip>
    );
  }
  if (state === "failed") {
    return (
      <Chip
        style={{
          color: "var(--bad)",
          background: "color-mix(in srgb, var(--bad) 18%, transparent)",
        }}
      >
        failed
      </Chip>
    );
  }
  if (state === "reading") {
    return (
      <Chip style={{ color: "var(--muted-fg)", background: "var(--panel-2)" }}>
        reading…
      </Chip>
    );
  }
  return (
    <Chip style={{ color: "var(--muted-fg)", background: "var(--panel-2)" }}>
      classifying…
    </Chip>
  );
}

function Chip({ children, style }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.4px",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function EmptyPlaceholder() {
  return (
    <div
      className="flex items-center justify-center rounded-[var(--radius-tile)] p-6 text-center"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--dim-fg)",
        border: "1px dashed var(--border)",
      }}
    >
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
