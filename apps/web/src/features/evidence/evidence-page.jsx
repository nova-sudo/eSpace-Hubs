"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge, Button, Card, PageHeader, SegmentedControl } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";
import { useHubLink } from "@/features/hubs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import { readInputsTruncated } from "@/features/goal-inputs";
import { ConfigPanel } from "./config-panel";
import { DocumentPreview } from "./document-preview";
import { ReviewPrepChecklist } from "./review-prep-checklist";
import { StarredEvidenceCard } from "./starred-evidence-card";
import { useStarredEvidence } from "./use-evidence";
import { useGoalReadings } from "./goal-readings";
import { buildGoalEvidenceGroups } from "./goal-evidence";
import { GoalEvidenceBoard } from "./goal-evidence-board";
import { EvidenceSummary } from "./evidence-summary";
import { downloadMarkdown, renderMarkdown } from "./markdown-export";
import { yearToDateLabel } from "@/lib/date";
import { apiGet, apiPost } from "@/lib/api-client";
import { generateEvidencePdf } from "./pdf/generate-pdf";

const NARRATIVE_DRAFT_KEY = "espace-devhub:evidence-narrative";

const VIEW_OPTIONS = [
  { value: "board", label: "Board" },
  { value: "compile", label: "Document" },
];

export function EvidencePage() {
  const { me } = useIntegrations();
  const searchParams = useSearchParams();
  const [format, setFormat] = useState("markdown");
  // "board" = the goal evidence board (primary); "compile" = the document builder.
  const [view, setView] = useState("board");
  const link = useHubLink();

  // Deep-link (`?view=compile` / legacy `?print=1`) opens the builder directly.
  useEffect(() => {
    if (searchParams?.get("print") === "1" || searchParams?.get("view") === "compile") {
      setView("compile");
    }
  }, [searchParams]);

  const [level, setLevel] = useState("L1 → L2");
  // #238: the narrative used to be bare useState — one navigation away
  // and a half-written review summary was gone. Draft lives in
  // localStorage (wiped on sign-out; the submitted packet is the record).
  // Load on mount (not in the initializer) so server and client render
  // the same empty textarea first — no hydration mismatch.
  const [narrative, setNarrative] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  useEffect(() => {
    try {
      setNarrative(window.localStorage.getItem(NARRATIVE_DRAFT_KEY) || "");
    } catch {
      /* storage unavailable — start empty */
    }
    setDraftLoaded(true);
  }, []);
  useEffect(() => {
    if (!draftLoaded) return; // never clobber the stored draft with the initial ""
    try {
      if (narrative) window.localStorage.setItem(NARRATIVE_DRAFT_KEY, narrative);
      else window.localStorage.removeItem(NARRATIVE_DRAFT_KEY);
    } catch {
      /* storage unavailable — draft just isn't persisted */
    }
  }, [narrative, draftLoaded]);
  // Goal-oriented review: only the summary narrative + the per-goal readings.
  // (The old integration sections — metrics, PRs, tickets, reviews — are gone;
  // GitHub/Jira aren't tracked anymore.)
  const [include, setInclude] = useState({ narrative: true, goals: true });

  // Goal-oriented data: per-goal readings + the check-in entries the user
  // logged against each goal. Windowed to year-to-date (the L2s are annual
  // goals). useAllGoalInputs subscribes the inputs store so the memo re-reads
  // readInputs() on hydration/change.
  const { ready, goalsError, retryGoals } = useGoalWidgetItems();
  const goalReadings = useGoalReadings();
  // Hand-picked proof artifacts (starred PRs/tickets) — rendered in the
  // sidebar card and as the document's "Starred proof" section.
  const starred = useStarredEvidence();
  // Enrichment (verdict, evidence, timing) lives in useGoalReadings now, so the
  // rows already carry everything — this just shelves them by L1.
  const evidence = useMemo(
    () => buildGoalEvidenceGroups(goalReadings),
    [goalReadings],
  );

  const rangeLabel = yearToDateLabel();
  // Real hydration signal (goals + specs loaded), NOT emptiness — otherwise a
  // user with zero classified goals sees a permanent spinner and never the
  // "set up your goals" empty state.
  const loading = !ready;

  // F1 — submission status. The "Review packet" sidebar shows when this
  // document was last submitted; submitting freezes it server-side as a
  // review packet the manager grades against. Fetched once on mount (not
  // gated on `view`) so the sidebar can show it from the board view too.
  const [submitting, setSubmitting] = useState(false);
  const [lastPacket, setLastPacket] = useState(null); // {submittedAt, hasManager} | null
  useEffect(() => {
    let cancelled = false;
    void apiGet("/review-packets/mine").then((r) => {
      if (cancelled || !r.ok) return;
      setLastPacket(r.data?.packets?.[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function buildDocProps() {
    return {
      name: me?.name,
      team: me?.team,
      level,
      rangeLabel,
      narrative,
      goalReadings,
      starred,
      include,
    };
  }

  async function handleSubmitForReview() {
    if (submitting) return;
    setSubmitting(true);
    const markdown = renderMarkdown(buildDocProps());
    // Clamp to the server's field caps so one long reading string can't
    // fail validation for the whole submit.
    const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
    const goals = goalReadings
      .filter((r) => r.level === "L2")
      .map((r) => ({
        goalId: r.goal.id,
        title: clip(r.goal.title, 1000) || "",
        l1Title: clip(r.parentL1?.title, 1000) || "",
        tier: clip(r.verdict?.tier, 50),
        reading: clip(r.reading?.value, 500),
        statusLabel: clip(r.reading?.statusLabel, 100),
      }));
    const r = await apiPost("/review-packets", {
      level,
      rangeLabel,
      narrative,
      markdown,
      goals,
      starredCount: starred.length,
    });
    setSubmitting(false);
    if (!r.ok) {
      toast.error(
        `Couldn't submit: ${r.error?.message || "the server didn't respond"}`,
      );
      return;
    }
    setLastPacket(r.data?.packet ?? null);
    if (r.data?.packet?.hasManager) {
      toast.success("Submitted for review.", {
        description:
          "Your manager received the frozen document — it's the record you'll both be looking at.",
      });
    } else {
      toast.success("Review packet saved.", {
        description:
          "No manager on file yet — the frozen version is stored and appears to a manager once one is assigned.",
      });
    }
  }

  async function handleDownloadMarkdown() {
    downloadMarkdown("performance-review-ytd.md", renderMarkdown(buildDocProps()));
    toast.success("Markdown downloaded");
  }

  async function handleExportPdf() {
    const t = toast.loading("Generating PDF…");
    try {
      await generateEvidencePdf(buildDocProps(), "performance-review-ytd.pdf");
      toast.success("PDF downloaded", { id: t });
    } catch (err) {
      toast.error(`PDF export failed: ${err?.message || err}`, { id: t });
    }
  }

  function SubmitCard() {
    return (
      <Card tone="sky" className="flex flex-col gap-3">
        <div className="text-[14px] font-bold">Submit for review</div>
        <p className="text-[13px] leading-[1.5] opacity-85">
          Freezes the document as it stands and notifies your manager. You can
          submit again after changes.
        </p>
        <Button
          size="sm"
          onClick={handleSubmitForReview}
          disabled={submitting || loading}
          className="self-start"
        >
          {submitting ? "Submitting…" : "Submit packet"}
        </Button>
        {lastPacket?.submittedAt ? (
          <div className="text-[12px] opacity-75">
            Last submitted{" "}
            {new Date(lastPacket.submittedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <main className="relative z-[2] px-4 sm:px-10 pb-14 pt-9">
      <PageHeader
        crumb={`Evidence · ${rangeLabel}`}
        title="Make the case."
        subtitle="Compile your goals — what each was set up to achieve, where it landed, and the evidence you logged — into one reviewable document your manager can review."
        right={
          <div className="flex items-center gap-2 no-print">
            <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} />
            <Button variant="soft" onClick={handleDownloadMarkdown}>
              Download .md
            </Button>
            <Button arrow onClick={handleExportPdf}>
              Export PDF
            </Button>
          </div>
        }
      />

      {readInputsTruncated() ? (
        <div className="mb-5 no-print">
          <Badge
            tone="lemon"
            title="Your check-in history hit the server's row cap — the oldest entries aren't loaded, so totals and compliance counts read as at-least, not exact."
          >
            History capped
          </Badge>
        </div>
      ) : null}

      {view === "board" ? (
        goalsError && !ready ? (
          <Card className="flex flex-col items-start gap-3">
            <div className="text-[15px] font-bold text-peach-ink">Couldn&apos;t load your goals</div>
            <p className="text-[13px] leading-[1.5] text-muted-fg">
              {goalsError.message || "The server didn't respond. Check your connection and try again."}
            </p>
            <Button onClick={() => void retryGoals()}>Retry</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <GoalEvidenceBoard
              groups={evidence.groups}
              loading={loading}
              goalsHref={link("/goals")}
            />
            <div className="flex flex-col gap-4 no-print">
              <Card>
                <ReviewPrepChecklist />
              </Card>
              <EvidenceSummary
                rangeLabel={rangeLabel}
                summary={evidence.summary}
                onCompile={() => setView("compile")}
                loading={loading}
                lastPacket={lastPacket}
              />
              <SubmitCard />
              <StarredEvidenceCard />
            </div>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 no-print">
            <ConfigPanel
              format={format}
              setFormat={setFormat}
              level={level}
              setLevel={setLevel}
              include={include}
              setInclude={setInclude}
              rangeLabel={rangeLabel}
            />
            <SubmitCard />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <DocumentPreview
              format={format}
              level={level}
              narrative={narrative}
              setNarrative={setNarrative}
              include={include}
              goalReadings={goalReadings}
              starred={starred}
              rangeLabel={rangeLabel}
            />
          </div>
        </div>
      )}
    </main>
  );
}
