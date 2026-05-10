"use client";

import { useEffect } from "react";
import { DitherField } from "@/components/ui";
import { GoalWidgetsGrid, useGoalWidgetItems } from "@/features/goal-widgets";
import {
  clearSpecs,
  removeSpec,
} from "@/features/goal-specs";
import { useAnalyst, ANALYST_MODES } from "./analyst-provider";
import { AnalysisStream } from "./analysis-stream";
import { useClassifyGoals, flattenGoalsForClassification } from "./use-classify-goals";
import { AnalystChatMode } from "./analyst-chat-mode";
import { AI_PROVIDERS, useAiProvider } from "./use-ai-provider";
import { useGoals } from "@/features/goals";

/**
 * Full-viewport analyst page. Swipes in from the right at the AppShell
 * level (mirrors how the old ChatPage worked).
 *
 * Three modes:
 *   - "widgets"   → default. Grid of GoalWidget cards, one per classified goal.
 *                   Empty state CTA runs classification.
 *   - "analysis"  → the process-reveal log while classification is running
 *                   (or after it completes).
 *   - "chat"      → the existing DevHub chat feature, demoted but reachable.
 */
export function AnalystPage() {
  const { open, close, mode, setMode } = useAnalyst();
  const { goals } = useGoals();
  const { items, hasGoals, hasSpecs, lastAnalyzedAt, unclassifiedGoals } =
    useGoalWidgetItems();
  const {
    events,
    phase,
    error,
    inProgress,
    start,
    abort,
    reset,
  } = useClassifyGoals();

  // Auto-switch to analysis mode while running; back to widgets on complete
  // only if the user is currently on analysis (don't steal focus if they
  // moved to chat).
  useEffect(() => {
    if (phase === "running" && mode !== ANALYST_MODES.ANALYSIS) {
      setMode(ANALYST_MODES.ANALYSIS);
    }
  }, [phase, mode, setMode]);

  function handleAnalyzeAll() {
    reset();
    setMode(ANALYST_MODES.ANALYSIS);
    start();
  }

  function handleReAnalyzeAll() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Re-analyze every goal? This discards existing widget classifications.",
      )
    )
      return;
    clearSpecs();
    reset();
    setMode(ANALYST_MODES.ANALYSIS);
    start();
  }

  function handleReAnalyzeGoal(goal) {
    removeSpec(goal.id);
    setMode(ANALYST_MODES.ANALYSIS);
    reset();
    start([
      {
        id: goal.id,
        title: goal.title,
        description: goal.rubric || "",
        parentL1Title: goal.parentL1Title,
        kind: goal.kind || "L2",
      },
    ]);
  }

  function handleAnalyzeRemaining() {
    const subset = unclassifiedGoals.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.rubric || "",
      parentL1Title: g.parentL1Title,
      kind: g.kind,
    }));
    if (subset.length === 0) return;
    reset();
    setMode(ANALYST_MODES.ANALYSIS);
    start(subset);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Analyst"
      aria-hidden={!open}
      className="fixed inset-0 z-[50] flex flex-col"
      style={{
        background: "var(--accent)",
        color: "var(--accent-on)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
        transitionProperty: "transform, visibility",
        transitionDuration: "320ms, 0s",
        transitionDelay: open ? "0s, 0s" : "0s, 320ms",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 opacity-25"
        style={{ color: "#ffffff" }}
      >
        <DitherField
          width={1720}
          height={1720}
          cell={8}
          color="currentColor"
          falloff={(u, v) =>
            Math.max(0, 1 - Math.sqrt((u - 0.6) ** 2 + (v - 0.3) ** 2) * 1.3)
          }
          jitter={0.35}
          seed={13}
        />
      </div>

      <AnalystHeader
        mode={mode}
        onMode={setMode}
        onClose={close}
        onAnalyzeAll={handleAnalyzeAll}
        onReAnalyzeAll={handleReAnalyzeAll}
        inProgress={inProgress}
        onAbort={abort}
        hasGoals={hasGoals}
        hasSpecs={hasSpecs}
        lastAnalyzedAt={lastAnalyzedAt}
      />

      <main className="relative z-[1] mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col gap-4 px-10 pb-6">
        {mode === ANALYST_MODES.ANALYSIS ? (
          <AnalysisStream
            events={events}
            phase={phase}
            error={error}
            onSwitchToGrid={() => setMode(ANALYST_MODES.WIDGETS)}
          />
        ) : mode === ANALYST_MODES.CHAT ? (
          <AnalystChatMode />
        ) : (
          <WidgetsMode
            items={items}
            hasGoals={hasGoals}
            hasSpecs={hasSpecs}
            unclassifiedCount={unclassifiedGoals.length}
            onAnalyzeAll={handleAnalyzeAll}
            onAnalyzeRemaining={handleAnalyzeRemaining}
            onReAnalyzeGoal={handleReAnalyzeGoal}
          />
        )}
      </main>
    </div>
  );
}

function AnalystHeader({
  mode,
  onMode,
  onClose,
  onAnalyzeAll,
  onReAnalyzeAll,
  inProgress,
  onAbort,
  hasGoals,
  hasSpecs,
  lastAnalyzedAt,
}) {
  return (
    <header
      className="relative z-[1] flex items-center justify-between gap-3 border-b px-10 py-3"
      style={{ borderColor: "rgba(255,255,255,0.15)" }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to dashboard"
          className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{ color: "#ffffff" }}
        >
          <BackGlyph />
        </button>
        <div>
          <div
            className="font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              letterSpacing: "-0.3px",
            }}
          >
            AI Goal Analyst
          </div>
          <div
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "rgba(255,255,255,0.7)",
            }}
          >
            Inverse · classified widgets
            {lastAnalyzedAt > 0
              ? ` · last run ${relativeTs(lastAnalyzedAt)}`
              : ""}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <AiProviderSelector />
        <ModeToggle mode={mode} onMode={onMode} />
        {inProgress ? (
          <button
            type="button"
            onClick={onAbort}
            className="rounded-[var(--radius-sub)] px-3 py-1.5 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              color: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            Abort
          </button>
        ) : hasGoals && !hasSpecs ? (
          <button
            type="button"
            onClick={onAnalyzeAll}
            className="rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.5px",
              background: "#ffffff",
              color: "var(--accent)",
            }}
          >
            Analyze my goals
          </button>
        ) : hasSpecs ? (
          <button
            type="button"
            onClick={onReAnalyzeAll}
            className="rounded-[var(--radius-sub)] px-3 py-1.5 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              color: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            Re-analyze all
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close analyst"
          className="rounded-[var(--radius-sub)] px-3 py-1.5 uppercase transition-colors hover:bg-[rgba(255,255,255,0.14)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.5px",
            color: "#ffffff",
          }}
        >
          Esc ✕
        </button>
      </div>
    </header>
  );
}

function ModeToggle({ mode, onMode }) {
  const MODES = [
    [ANALYST_MODES.WIDGETS, "Widgets"],
    [ANALYST_MODES.ANALYSIS, "Analysis"],
    [ANALYST_MODES.CHAT, "Chat"],
  ];
  return (
    <div
      className="flex items-center rounded-full p-0.5"
      style={{
        background: "rgba(255,255,255,0.1)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}
    >
      {MODES.map(([value, label]) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onMode(value)}
            className="rounded-full px-3 py-1 uppercase transition-colors"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              background: active ? "#ffffff" : "transparent",
              color: active ? "var(--accent)" : "rgba(255,255,255,0.85)",
              fontWeight: active ? 700 : 500,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function WidgetsMode({
  items,
  hasGoals,
  hasSpecs,
  unclassifiedCount,
  onAnalyzeAll,
  onAnalyzeRemaining,
  onReAnalyzeGoal,
}) {
  if (!hasGoals) {
    return (
      <EmptyCta
        title="Add goals first"
        body="Head to Settings and paste in your L1/L2 performance goals, then come back here to let the analyst classify them into trackable widgets."
        ctaLabel="Open Settings"
        ctaHref="/settings"
      />
    );
  }
  if (!hasSpecs) {
    return (
      <EmptyCta
        title="Classify your goals"
        body="The analyst will read every L1 and L2 goal and assign each one a live dashboard widget — automatic where your code hosts can measure it, manual where you self-report."
        ctaLabel="Analyze my goals"
        onCta={onAnalyzeAll}
      />
    );
  }
  const annotatedItems = items.map((it) => ({
    ...it,
    onRetry: () => onReAnalyzeGoal(it.goal),
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {unclassifiedCount > 0 ? (
        <div
          className="flex items-center justify-between rounded-[var(--radius-tile)] px-3 py-2"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.18)",
          }}
        >
          <span
            className="uppercase tracking-[0.5px]"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "rgba(255,255,255,0.8)",
            }}
          >
            {unclassifiedCount} goal{unclassifiedCount === 1 ? "" : "s"} unclassified
          </span>
          <button
            type="button"
            onClick={onAnalyzeRemaining}
            className="rounded-[var(--radius-sub)] px-3 py-1 font-bold uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              background: "#ffffff",
              color: "var(--accent)",
            }}
          >
            Analyze remaining
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <GoalWidgetsGrid items={annotatedItems} variant="light" />
      </div>
    </div>
  );
}

function EmptyCta({ title, body, ctaLabel, ctaHref, onCta }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div
        className="flex max-w-[520px] flex-col items-start gap-4 rounded-[var(--radius-tile)] p-8"
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.18)",
        }}
      >
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 24,
            letterSpacing: "-0.6px",
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.6,
            color: "rgba(255,255,255,0.82)",
          }}
        >
          {body}
        </div>
        {onCta ? (
          <button
            type="button"
            onClick={onCta}
            className="rounded-[var(--radius-sub)] px-4 py-2 font-bold uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.6px",
              background: "#ffffff",
              color: "var(--accent)",
            }}
          >
            {ctaLabel}
          </button>
        ) : (
          <a
            href={ctaHref}
            className="rounded-[var(--radius-sub)] px-4 py-2 font-bold uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.6px",
              background: "#ffffff",
              color: "var(--accent)",
            }}
          >
            {ctaLabel}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Tiny pill-style selector for the AI provider. Persists the choice via
 * `useAiProvider` (localStorage). Every AI fetch in the app reads the
 * same key, so flipping this immediately reroutes chat / classify-goals
 * / grade-pr to the selected provider.
 */
function AiProviderSelector() {
  const { provider, setProvider } = useAiProvider();
  return (
    <div
      className="flex items-center gap-1 rounded-full px-1 py-1"
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)",
      }}
      role="radiogroup"
      aria-label="AI provider"
    >
      {AI_PROVIDERS.map((p) => {
        const active = provider === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setProvider(p.id)}
            className="rounded-full px-2.5 py-1 transition-colors"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.4px",
              textTransform: "uppercase",
              fontWeight: 700,
              background: active ? "#ffffff" : "transparent",
              color: active ? "var(--accent)" : "rgba(255,255,255,0.85)",
            }}
            title={`Use ${p.label} for chat / classification / grading. Requires ${p.env} in .env.local.`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function BackGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function relativeTs(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
