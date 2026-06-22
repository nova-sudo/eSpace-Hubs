"use client";

import { useEffect } from "react";
import { GoalWidgetsGrid, useGoalWidgetItems } from "@/features/goal-widgets";
import { clearSpecs, removeSpec } from "@/features/goal-specs";
import { useAnalyst, ANALYST_MODES } from "./analyst-provider";
import { AnalysisStream } from "./analysis-stream";
import { ReviewPane } from "./review-pane";
import { useClassifyGoals, flattenGoalsForClassification } from "./use-classify-goals";
import { AnalystChatMode } from "./analyst-chat-mode";
import { AI_PROVIDERS, useAiProvider } from "./use-ai-provider";
import { GlyphMatrix, glyphStateFor } from "./glyph-matrix";
import { useGoals } from "@/features/goals";

/**
 * Full-viewport analyst — the "GLYPH" instrument. Swipes in from the right at
 * the AppShell level. A two-column body: a persistent dark instrument rail
 * (the dot-matrix machine, always dark in both themes) beside a workspace that
 * follows the app theme. The workspace switches between modes:
 *   - "widgets"   → grid of GoalWidget cards (Launch CTA when empty)
 *   - "analysis"  → the process-reveal log while classification runs
 *   - "review"    → vet/edit pending specs before they land
 *   - "chat"      → the demoted-but-reachable chat
 */
export function AnalystPage() {
  const { open, close, mode, setMode } = useAnalyst();
  const { goals } = useGoals();
  const { items, hasGoals, hasSpecs, lastAnalyzedAt, unclassifiedGoals } =
    useGoalWidgetItems();
  const { provider } = useAiProvider();
  const {
    events,
    phase,
    error,
    inProgress,
    start,
    abort,
    reset,
    pendingSpecs,
    pendingCount,
    commitSpec,
    commitAllPending,
    discardSpec,
    discardAllPending,
    updatePendingSpec,
  } = useClassifyGoals();

  // Auto-switch to analysis while running; flip to review when a run finishes
  // with pending specs to vet. If nothing's pending (all failed) stay on
  // analysis so the failure list + retry are visible.
  useEffect(() => {
    if (phase === "running" && mode !== ANALYST_MODES.ANALYSIS) {
      setMode(ANALYST_MODES.ANALYSIS);
    }
    if (
      phase === "complete" &&
      pendingCount > 0 &&
      (mode === ANALYST_MODES.ANALYSIS || mode === ANALYST_MODES.WIDGETS)
    ) {
      setMode(ANALYST_MODES.REVIEW);
    }
  }, [phase, mode, pendingCount, setMode]);

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

  function handleRetryGoalById(goalId) {
    const flat = flattenGoalsForClassification(goals);
    const goal = flat.find((g) => g.id === goalId);
    if (!goal) return;
    handleReAnalyzeGoal({
      id: goal.id,
      title: goal.title,
      rubric: goal.description,
      parentL1Title: goal.parentL1Title,
      kind: goal.kind,
    });
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

  const glyphState = glyphStateFor({ mode, phase, hasSpecs });
  const total = items.length + unclassifiedGoals.length;
  const providerLabel =
    AI_PROVIDERS.find((p) => p.id === provider)?.label || "—";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Analyst"
      aria-hidden={!open}
      className="fixed inset-0 z-[50] flex flex-col"
      style={{
        background: "var(--bg)",
        color: "var(--fg)",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
        transitionProperty: "transform, visibility",
        transitionDuration: "320ms, 0s",
        transitionDelay: open ? "0s, 0s" : "0s, 320ms",
      }}
    >
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
      />

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: "300px minmax(0, 1fr)" }}
      >
        <AnalystRail
          glyphState={glyphState}
          classified={`${items.length}/${total || 0}`}
          providerLabel={providerLabel}
          lastRun={lastAnalyzedAt > 0 ? relativeTs(lastAnalyzedAt) : "—"}
          reviewCount={pendingCount}
          liveCount={items.length}
        />

        <main
          className="relative min-h-0 overflow-y-auto"
          style={{ background: "var(--bg)", padding: "24px 28px 32px" }}
        >
          {mode === ANALYST_MODES.ANALYSIS ? (
            <AnalysisStream
              events={events}
              phase={phase}
              error={error}
              onSwitchToGrid={() => {
                if (pendingCount > 0) setMode(ANALYST_MODES.REVIEW);
                else setMode(ANALYST_MODES.WIDGETS);
              }}
            />
          ) : mode === ANALYST_MODES.REVIEW ? (
            <ReviewPane
              pendingSpecs={pendingSpecs}
              events={events}
              commitSpec={commitSpec}
              commitAllPending={commitAllPending}
              discardSpec={discardSpec}
              discardAllPending={discardAllPending}
              updatePendingSpec={updatePendingSpec}
              onSwitchToGrid={() => setMode(ANALYST_MODES.WIDGETS)}
              onRetryGoal={handleRetryGoalById}
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
    </div>
  );
}

/* ─── Instrument rail (always the dark machine) ─────────────────────────── */

const GLYPH_META = {
  idle: { word: "IDLE", color: "var(--glyph-idle)", cap: "IDLE", sub: "ready to analyze" },
  thinking: { word: "THINKING", color: "var(--glyph-thinking)", cap: "SCAN", sub: "reading your goals" },
  review: { word: "REVIEW", color: "var(--glyph-review)", cap: "VET", sub: "awaiting your call" },
  live: { word: "LIVE", color: "var(--glyph-live)", cap: "LIVE", sub: "widgets tracking" },
  talk: { word: "LISTENING", color: "var(--glyph-talk)", cap: "TALK", sub: "ask anything" },
};

function AnalystRail({ glyphState, classified, providerLabel, lastRun, reviewCount, liveCount }) {
  const meta = GLYPH_META[glyphState] || GLYPH_META.idle;
  const sub =
    glyphState === "review"
      ? `${reviewCount} awaiting your call`
      : glyphState === "live"
        ? `${liveCount} widget${liveCount === 1 ? "" : "s"} tracking`
        : meta.sub;
  const stats = [
    { label: "Classified", value: classified, color: "#ffffff" },
    { label: "Provider", value: providerLabel, color: "var(--glyph-on)" },
    { label: "Last run", value: lastRun, color: "rgba(255,255,255,0.75)" },
  ];
  return (
    <aside
      className="relative flex flex-col justify-between overflow-hidden"
      style={{
        background: "var(--glyph-rail-bg)",
        borderRight: "1px solid var(--glyph-rail-line)",
        padding: "22px 22px 20px",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "13px 13px",
          opacity: 0.05,
        }}
      />

      {/* top: engine label + pulse */}
      <div className="relative flex items-center justify-between">
        <span
          className="uppercase"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "1.5px", color: "rgba(255,255,255,0.5)" }}
        >
          Glyph engine
        </span>
        <span
          className="inline-flex items-center gap-1.5 uppercase"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.5px", color: meta.color }}
        >
          <i style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
          {meta.word}
        </span>
      </div>

      {/* the dot-matrix display */}
      <div className="relative self-center" style={{ margin: "10px 0" }}>
        <GlyphMatrix state={glyphState} />
      </div>

      {/* caption */}
      <div className="relative text-center" style={{ marginBottom: 4 }}>
        <div
          className="uppercase"
          style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 24, letterSpacing: "3px", color: "#fff" }}
        >
          {meta.cap}
        </div>
        <div
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.5px", color: "rgba(255,255,255,0.55)", marginTop: 5 }}
        >
          {sub}
        </div>
      </div>

      {/* stats */}
      <div
        className="relative flex flex-col"
        style={{ gap: 1, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 14 }}
      >
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between" style={{ padding: "6px 0" }}>
            <span
              className="uppercase"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "1px", color: "rgba(255,255,255,0.5)" }}
            >
              {s.label}
            </span>
            <span style={{ fontFamily: "var(--font-dot)", fontWeight: 700, fontSize: 14, letterSpacing: "1px", color: s.color }}>
              {s.value}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ─── Header ─────────────────────────────────────────────────────────────── */

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
}) {
  return (
    <header
      className="relative z-[2] flex items-center justify-between gap-3 border-b px-6 py-3"
      style={{ background: "var(--head-bg)", borderColor: "var(--border)" }}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to dashboard"
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full transition-colors hover:bg-accent-dim"
          style={{ border: "1px solid var(--border-strong)", color: "var(--fg)", fontSize: 15 }}
        >
          ‹
        </button>
        <div className="flex min-w-0 items-baseline gap-2">
          <span style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 20, letterSpacing: "2px", color: "var(--fg)" }}>
            GLYPH
          </span>
          <span
            className="truncate uppercase"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "1.5px", color: "var(--muted-fg)" }}
          >
            / AI Goal Analyst
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <AiProviderSelector />
        <ModeToggle mode={mode} onMode={onMode} />
        {inProgress ? (
          <GhostBtn onClick={onAbort}>Abort</GhostBtn>
        ) : hasGoals && !hasSpecs ? (
          <AccentBtn onClick={onAnalyzeAll}>Analyze my goals</AccentBtn>
        ) : hasSpecs ? (
          <GhostBtn onClick={onReAnalyzeAll}>Re-analyze all</GhostBtn>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close analyst"
          className="uppercase"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.5px", color: "var(--muted-fg)" }}
        >
          Esc ✕
        </button>
      </div>
    </header>
  );
}

function GhostBtn({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-sub)] px-3.5 py-2 uppercase transition-colors hover:border-accent hover:text-accent"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.5px",
        color: "var(--fg)",
        border: "1px solid var(--border-strong)",
        background: "transparent",
      }}
    >
      {children}
    </button>
  );
}

function AccentBtn({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[var(--radius-sub)] px-3.5 py-2 font-bold uppercase transition-[filter] hover:brightness-110"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.5px",
        background: "var(--accent)",
        color: "var(--accent-on)",
        border: "1px solid var(--accent)",
      }}
    >
      {children}
    </button>
  );
}

function ModeToggle({ mode, onMode }) {
  const MODES = [
    [ANALYST_MODES.WIDGETS, "Widgets"],
    [ANALYST_MODES.ANALYSIS, "Analysis"],
    [ANALYST_MODES.REVIEW, "Review"],
    [ANALYST_MODES.CHAT, "Chat"],
  ];
  return (
    <div
      className="flex items-center rounded-full p-[3px]"
      style={{ background: "var(--chip-track)", border: "1px solid var(--border)" }}
    >
      {MODES.map(([value, label]) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onMode(value)}
            className="rounded-full px-2.5 py-1 uppercase transition-colors"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: "0.5px",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--accent-on)" : "var(--muted-fg)",
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

/**
 * Pill selector for the AI provider. Persists via useAiProvider (localStorage);
 * every AI fetch reads the same key, so flipping it reroutes chat / classify /
 * grade to the chosen provider immediately.
 */
function AiProviderSelector() {
  const { provider, setProvider } = useAiProvider();
  return (
    <div
      className="flex items-center gap-0.5 rounded-full p-[3px]"
      style={{ background: "var(--chip-track)", border: "1px solid var(--border)" }}
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
            className="rounded-full px-2.5 py-1 uppercase transition-colors"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.4px",
              fontWeight: 700,
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--accent-on)" : "var(--muted-fg)",
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

/* ─── Widgets workspace ──────────────────────────────────────────────────── */

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
      <Launch
        title="Add goals first"
        body="Head to Settings and paste in your L1/L2 performance goals, then come back here to let Glyph classify them into trackable widgets."
        ctaLabel="Open Settings"
        ctaHref="/settings"
      />
    );
  }
  if (!hasSpecs) {
    return (
      <Launch
        title="Classify your goals"
        body="Glyph reads every L1 and L2 goal and assigns each a live dashboard widget — automatic where your code hosts can measure it, manual where you self-report. You review everything before it lands."
        ctaLabel="Analyze my goals →"
        onCta={onAnalyzeAll}
        showSteps
      />
    );
  }
  const annotatedItems = items.map((it) => ({
    ...it,
    onRetry: () => onReAnalyzeGoal(it.goal),
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      {unclassifiedCount > 0 ? (
        <div
          className="flex items-center justify-between gap-3 rounded-[var(--radius-tile)] px-4 py-2.5"
          style={{ background: "var(--accent-dim)", border: "1px solid var(--accent)" }}
        >
          <span
            className="uppercase"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "1px", color: "var(--fg)" }}
          >
            {unclassifiedCount} goal{unclassifiedCount === 1 ? "" : "s"} unclassified
          </span>
          <AccentBtn onClick={onAnalyzeRemaining}>Analyze remaining</AccentBtn>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <GoalWidgetsGrid items={annotatedItems} variant="dark" />
      </div>
    </div>
  );
}

/**
 * The Launch / empty-state hero — eyebrow + dot-matrix headline + lede + CTAs,
 * with an optional three-step "how it works" row (shown pre-analysis).
 */
function Launch({ title, body, ctaLabel, ctaHref, onCta, showSteps }) {
  const STEPS = [
    { n: "01", title: "Read goals", body: "Parses every L1 + L2 title and rubric." },
    { n: "02", title: "Match a widget", body: "Auto metric, manual check-in, or hybrid." },
    { n: "03", title: "You review", body: "Edit, skip, or flag before it saves." },
  ];
  return (
    <div style={{ maxWidth: 680 }}>
      <h1
        className="uppercase"
        style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 44, lineHeight: 0.95, letterSpacing: "1px", color: "var(--fg)", margin: 0 }}
      >
        {title}
        <span style={{ color: "var(--accent)" }}>.</span>
      </h1>
      <p
        style={{ fontFamily: "var(--font-sans)", fontSize: 15, lineHeight: 1.6, color: "var(--muted-fg)", maxWidth: 520, margin: "18px 0 0" }}
      >
        {body}
      </p>
      <div className="flex gap-2.5" style={{ margin: "24px 0 0" }}>
        {onCta ? (
          <AccentBtn onClick={onCta}>{ctaLabel}</AccentBtn>
        ) : (
          <a href={ctaHref} style={{ textDecoration: "none" }}>
            <AccentBtn>{ctaLabel}</AccentBtn>
          </a>
        )}
      </div>

      {showSteps ? (
        <div className="mt-7 grid gap-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {STEPS.map((st) => (
            <div
              key={st.n}
              className="rounded-[var(--radius-tile)] p-4"
              style={{ border: "1px solid var(--border)", background: "var(--card)" }}
            >
              <div style={{ fontFamily: "var(--font-dot)", fontWeight: 900, fontSize: 18, letterSpacing: "1px", color: "var(--accent)" }}>
                {st.n}
              </div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 13, color: "var(--fg)", marginTop: 8 }}>
                {st.title}
              </div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: 1.5, color: "var(--muted-fg)", marginTop: 5 }}>
                {st.body}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
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
