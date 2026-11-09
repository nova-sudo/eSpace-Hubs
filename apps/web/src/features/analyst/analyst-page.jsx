"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button, IconButton, Select, Field, Label, Badge, useFocusTrap } from "@/components/ui";
import { ComposeWidgetModal, GoalWidgetsGrid, useGoalWidgetItems } from "@/features/goal-widgets";
import { useHubLink } from "@/features/hubs";
import { useAnalyst, ANALYST_MODES } from "./analyst-provider";
import { AnalysisStream } from "./analysis-stream";
import { ReviewPane } from "./review-pane";
import { useClassifyGoals, flattenGoalsForClassification } from "./use-classify-goals";
import { AnalystChatMode } from "./analyst-chat-mode";
import { GoalPicker } from "./goal-picker";
import { AI_PROVIDERS, useAiProvider } from "./use-ai-provider";
import { useGoals } from "@/features/goals";

/**
 * Full-viewport analyst overlay. Swipes in from the right at the AppShell
 * level (see the transform below, mirrored by AppShell's dashboard-body
 * translate). A themed page: a header, a left column of mode pills + the
 * AI provider picker + the run/re-analyze action, and a white card
 * workspace holding whatever the current mode renders:
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
  const { provider, setProvider } = useAiProvider();
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
    pendingCommitImpact,
    pendingCommitImpactAll,
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

  // Re-analysis NEVER deletes the current trackers up front. The new
  // proposals land in the Review buffer and only replace a tracker when the
  // user saves that card — so an aborted or failed run leaves everything as
  // it was, instead of a goals page with no trackers at all.
  function handleReAnalyzeAll() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Re-analyze every goal? Your current trackers stay in place until you save the new proposals from the Review tab.",
      )
    )
      return;
    reset();
    setMode(ANALYST_MODES.ANALYSIS);
    start();
  }

  function handleReAnalyzeGoal(goal) {
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

  // Run on exactly the goals the user picked. Same rich input shape as
  // "Analyze all"; classified goals in the pick get new proposals in
  // Review and keep their current tracker until one is saved.
  function handleAnalyzeIds(ids) {
    const want = new Set(ids);
    const subset = flattenGoalsForClassification(goals).filter((g) => want.has(g.id));
    if (subset.length === 0) return;
    reset();
    setMode(ANALYST_MODES.ANALYSIS);
    start(subset);
  }

  function handleAnalyzeRemaining() {
    handleAnalyzeIds(unclassifiedGoals.map((g) => g.id));
  }

  const total = items.length + unclassifiedGoals.length;

  // Dialog a11y: trap Tab inside while open (initial focus lands on the
  // first control — the close button) and Escape closes. Focus goes back to
  // whatever opened the overlay via useFocusTrap itself: it captures the
  // opener BEFORE moving focus in (capturing it here, after the trap ran,
  // saved the close button) and retries a frame later while the shell is
  // still `inert`.
  const trapRef = useFocusTrap(open);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // A nested dialog (compose, goal widget) portals to <body> and handles
      // its own Escape — don't close the whole overlay underneath it.
      const owner = e.target instanceof Element ? e.target.closest('[aria-modal="true"]') : null;
      if (owner && owner !== trapRef.current) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, trapRef]);

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyst-dialog-title"
      aria-hidden={!open}
      className="fixed inset-0 z-[50] flex flex-col bg-bg text-fg"
      style={{
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
        transitionProperty: "transform, visibility",
        transitionDuration: "320ms, 0s",
        transitionDelay: open ? "0s, 0s" : "0s, 320ms",
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-10">
        <h1 id="analyst-dialog-title" className="text-[18px] font-bold tracking-[-0.01em] text-fg">
          Analyst
        </h1>
        <IconButton label="Close analyst" onClick={close}>
          <X size={18} />
        </IconButton>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 sm:p-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:overflow-hidden">
        <AnalystSidebar
          mode={mode}
          onMode={setMode}
          provider={provider}
          setProvider={setProvider}
          inProgress={inProgress}
          onAbort={abort}
          hasGoals={hasGoals}
          hasSpecs={hasSpecs}
          pendingCount={pendingCount}
          onAnalyzeAll={handleAnalyzeAll}
          onReAnalyzeAll={handleReAnalyzeAll}
          unclassifiedCount={unclassifiedGoals.length}
          onAnalyzeRemaining={handleAnalyzeRemaining}
          classified={`${items.length}/${total || 0}`}
          lastRun={lastAnalyzedAt > 0 ? relativeTs(lastAnalyzedAt) : "—"}
        />

        <div
          className="min-h-0 rounded-[var(--radius-xl)] bg-card lg:overflow-y-auto"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex min-h-full flex-col p-5 sm:p-7">
            {mode === ANALYST_MODES.ANALYSIS ? (
              <AnalysisStream
                events={events}
                phase={phase}
                error={error}
                unclassifiedCount={unclassifiedGoals.length}
                onClassify={
                  unclassifiedGoals.length > 0
                    ? handleAnalyzeRemaining
                    : hasGoals
                      ? handleAnalyzeAll
                      : undefined
                }
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
                pendingCommitImpact={pendingCommitImpact}
                pendingCommitImpactAll={pendingCommitImpactAll}
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
                unclassifiedGoals={unclassifiedGoals}
                pickableGoals={flattenGoalsForClassification(goals)}
                inProgress={inProgress}
                onAnalyzeAll={handleAnalyzeAll}
                onAnalyzeIds={handleAnalyzeIds}
                onReAnalyzeGoal={handleReAnalyzeGoal}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sidebar: mode pills + AI provider + run action ────────────────────── */

const MODE_OPTIONS = [
  [ANALYST_MODES.WIDGETS, "Widgets"],
  [ANALYST_MODES.ANALYSIS, "Analysis"],
  [ANALYST_MODES.REVIEW, "Review"],
  [ANALYST_MODES.CHAT, "Chat"],
];

function AnalystSidebar({
  mode,
  onMode,
  provider,
  setProvider,
  inProgress,
  onAbort,
  hasGoals,
  hasSpecs,
  pendingCount,
  onAnalyzeAll,
  onReAnalyzeAll,
  unclassifiedCount = 0,
  onAnalyzeRemaining,
  classified,
  lastRun,
}) {
  return (
    <aside className="flex flex-none flex-col gap-4 lg:w-[220px]">
      <div className="flex flex-row flex-wrap gap-1.5 lg:flex-col">
        {MODE_OPTIONS.map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={mode === value ? "ink" : "soft"}
            size="sm"
            onClick={() => onMode(value)}
            className="justify-start lg:w-full"
          >
            {label}
            {value === ANALYST_MODES.REVIEW && pendingCount > 0 ? (
              <Badge tone={mode === value ? "ink" : "lemon"}>{pendingCount}</Badge>
            ) : null}
          </Button>
        ))}
      </div>

      <Field label="AI provider">
        <Select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          aria-label="AI provider"
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>

      {inProgress ? (
        <Button variant="soft" size="sm" onClick={onAbort}>
          Abort
        </Button>
      ) : hasGoals && !hasSpecs ? (
        <Button variant="ink" size="sm" onClick={onAnalyzeAll}>
          Run analysis
        </Button>
      ) : hasSpecs ? (
        <>
          {unclassifiedCount > 0 ? (
            <Button variant="ink" size="sm" onClick={onAnalyzeRemaining}>
              Classify remaining {unclassifiedCount}
            </Button>
          ) : null}
          <Button variant={unclassifiedCount > 0 ? "soft" : "ink"} size="sm" onClick={onReAnalyzeAll}>
            Re-analyze all
          </Button>
        </>
      ) : null}

      <div className="flex flex-col gap-1">
        <div className="text-[12px] text-muted-fg">
          Classified <span className="font-bold text-fg">{classified}</span>
        </div>
        <div className="text-[12px] text-muted-fg">
          Last run <span className="font-bold text-fg">{lastRun}</span>
        </div>
      </div>
    </aside>
  );
}

/* ─── Widgets workspace ──────────────────────────────────────────────────── */

function WidgetsMode({
  items,
  hasGoals,
  hasSpecs,
  unclassifiedGoals,
  pickableGoals,
  inProgress,
  onAnalyzeAll,
  onAnalyzeIds,
  onReAnalyzeGoal,
}) {
  // A goal the user picked "Build my own" for — bypasses the classifier
  // entirely. `ComposeWidgetModal` only ever reads `spec?.goalId` /
  // `spec?.title` off its `spec` prop (nothing else, checked against the
  // component directly), so a bare `{ goalId }` stub is enough to drive it
  // for a goal that has never been classified — no placeholder spec needs
  // to exist first.
  const [composeGoal, setComposeGoal] = useState(null);
  const composeModal = (
    <ComposeWidgetModal
      open={Boolean(composeGoal)}
      onClose={() => setComposeGoal(null)}
      spec={composeGoal ? { goalId: composeGoal.id } : null}
      goal={composeGoal}
      onSaved={() => setComposeGoal(null)}
    />
  );

  // The picker lists the classifier's own L2 shape; "Build my own" wants
  // the full goal row the compose modal was always handed.
  const classifiedIds = new Set(items.map((it) => it.goal.id));
  const invalidIds = new Set(unclassifiedGoals.filter((g) => g.invalidSpec).map((g) => g.id));
  const picker = (
    <GoalPicker
      goals={pickableGoals}
      classifiedIds={classifiedIds}
      invalidIds={invalidIds}
      disabled={inProgress}
      onAnalyze={onAnalyzeIds}
      onBuildOwn={(g) => setComposeGoal(unclassifiedGoals.find((u) => u.id === g.id) || g)}
    />
  );

  if (!hasGoals) {
    return (
      <Launch
        title="Add goals first"
        body="Add your L1/L2 performance goals in Settings (by hand or from a Zoho export), then come back here to let the analyst classify them into trackers."
        ctaLabel="Add or import goals"
        ctaHref="/settings?tab=goals"
      />
    );
  }
  if (!hasSpecs) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
        <Launch
          title="Classify your goals"
          body="The analyst reads your L2 goals and assigns each a tracker — automatic where your code hosts can measure it, manual where you self-report. You review everything before it lands. Only want some of them analyzed? Pick them below. Already have a plan for one? Use Build my own instead of waiting on the classifier."
          ctaLabel="Analyze my goals"
          onCta={onAnalyzeAll}
          showSteps
        />
        {picker}
        {composeModal}
      </div>
    );
  }
  const annotatedItems = items.map((it) => ({
    ...it,
    onRetry: () => onReAnalyzeGoal(it.goal),
  }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      {picker}
      <div className="min-h-0 flex-1">
        <GoalWidgetsGrid items={annotatedItems} />
      </div>
      {composeModal}
    </div>
  );
}

/**
 * The Launch / empty-state hero — title + lede + CTA, with an optional
 * three-step "how it works" row (shown pre-analysis).
 */
function Launch({ title, body, ctaLabel, ctaHref, onCta, showSteps }) {
  // Hub-prefixed: a bare "/settings" is not a route in this app.
  const link = useHubLink();
  const STEPS = [
    { n: "1", title: "Read goals", body: "Parses every L1 + L2 title and rubric." },
    { n: "2", title: "Match a widget", body: "Auto metric, manual check-in, or hybrid." },
    { n: "3", title: "You review", body: "Edit, skip, or flag before it saves." },
  ];
  return (
    <div className="max-w-[680px]">
      <h2 className="text-[15px] font-bold leading-[1.3] text-fg">{title}</h2>
      <p className="mt-2 max-w-[520px] text-[13px] leading-[1.5] text-muted-fg">{body}</p>
      <div className="mt-5 flex gap-2.5">
        {onCta ? (
          <Button variant="ink" size="sm" onClick={onCta}>
            {ctaLabel}
          </Button>
        ) : (
          <Button as={Link} href={link(ctaHref)} variant="ink" size="sm">
              {ctaLabel}
            </Button>
        )}
      </div>

      {showSteps ? (
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {STEPS.map((st) => (
            <div key={st.n} className="rounded-[var(--radius-lg)] bg-card-alt p-4">
              <Label>{st.n}</Label>
              <div className="mt-2 text-[13px] font-bold text-fg">{st.title}</div>
              <div className="mt-1 text-[12px] leading-[1.5] text-muted-fg">{st.body}</div>
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
