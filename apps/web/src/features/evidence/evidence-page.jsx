"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button, PageHeader } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";
import { useHubLink } from "@/features/hubs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
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
  const [narrative, setNarrative] = useState("");
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

  // F1 — submission status. The compile view shows when this document
  // was last submitted; submitting freezes it server-side as a review
  // packet the manager grades against.
  const [submitting, setSubmitting] = useState(false);
  const [lastPacket, setLastPacket] = useState(null); // {submittedAt, hasManager} | null
  useEffect(() => {
    if (view !== "compile") return;
    let cancelled = false;
    void apiGet("/review-packets/mine").then((r) => {
      if (cancelled || !r.ok) return;
      setLastPacket(r.data?.packets?.[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

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

  async function handleExport() {
    const props = buildDocProps();
    if (format === "pdf") {
      const t = toast.loading("Generating PDF…");
      try {
        await generateEvidencePdf(props, "performance-review-ytd.pdf");
        toast.success("PDF downloaded", { id: t });
      } catch (err) {
        toast.error(`PDF export failed: ${err?.message || err}`, { id: t });
      }
      return;
    }
    downloadMarkdown("performance-review-ytd.md", renderMarkdown(props));
    toast.success("Markdown downloaded");
  }

  // ── Board view (primary): goal evidence, grouped by L1 ──
  if (view === "board") {
    return (
      <main className="relative z-[2] px-4 sm:px-10 pb-14 pt-9">
        <div className="mb-6 no-print">
          <ReviewPrepChecklist />
        </div>
        <PageHeader
          crumb="Evidence · goals"
          title="Proof for your review."
          italicWord="."
          right={
            <span
              className="uppercase tracking-[0.6px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              {rangeLabel}
            </span>
          }
        />
        {goalsError && !ready ? (
          // Failed /goals fetch: without this branch the board reads
          // "Reading your goals…" forever (the store no longer auto-retries).
          <div className="flex flex-col items-start gap-3 rounded-[var(--radius-sub)] border border-dashed border-[color-mix(in_srgb,var(--bad)_35%,transparent)] bg-[color-mix(in_srgb,var(--bad)_6%,transparent)] p-5">
            <div
              className="uppercase tracking-[1px] text-bad"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              Couldn&apos;t load your goals
            </div>
            <p className="text-[13px] leading-[1.5] text-muted-fg">
              {goalsError.message || "The server didn't respond. Check your connection and try again."}
            </p>
            <Button onClick={() => void retryGoals()}>Retry</Button>
          </div>
        ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-[26px]">
          <GoalEvidenceBoard
            groups={evidence.groups}
            loading={loading}
            goalsHref={link("/goals")}
          />
          <div className="flex flex-col gap-[13px]">
            <EvidenceSummary
              rangeLabel={rangeLabel}
              summary={evidence.summary}
              onCompile={() => setView("compile")}
              loading={loading}
            />
            <StarredEvidenceCard />
          </div>
        </div>
        )}
      </main>
    );
  }

  // ── Compile view: the goals-only document builder ──
  return (
    <main className="relative z-[2] px-4 sm:px-10 pb-14 pt-9">
      <div className="mb-6 no-print">
        <ReviewPrepChecklist />
      </div>
      <PageHeader
        crumb="Evidence · year-to-date goal review"
        title="Make the case."
        italicWord="case"
        subtitle="Compile your goals — what each was set up to achieve, where it landed, and the evidence you logged — into one reviewable document."
        right={
          <div className="flex flex-col items-end gap-1.5 no-print">
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setView("board")}>
                ← Goals
              </Button>
              <Button variant="ghost" onClick={handleExport}>
                Export {format === "markdown" ? ".md" : ".pdf"}
              </Button>
              <Button size="lg" onClick={handleSubmitForReview} disabled={submitting || loading}>
                {submitting ? "Submitting…" : "Submit for review"}
              </Button>
            </div>
            {lastPacket?.submittedAt ? (
              <span
                className="uppercase tracking-[0.5px] text-dim-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
              >
                Last submitted{" "}
                {new Date(lastPacket.submittedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-5">
        <div className="no-print">
          <ConfigPanel
            format={format}
            setFormat={setFormat}
            level={level}
            setLevel={setLevel}
            include={include}
            setInclude={setInclude}
            rangeLabel={rangeLabel}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-[18px]">
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
    </main>
  );
}
