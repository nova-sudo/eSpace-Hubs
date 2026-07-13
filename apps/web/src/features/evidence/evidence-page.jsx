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
import { useGoalReadings } from "./goal-readings";
import { buildGoalEvidenceGroups } from "./goal-evidence";
import { GoalEvidenceBoard } from "./goal-evidence-board";
import { EvidenceSummary } from "./evidence-summary";
import { downloadMarkdown, renderMarkdown } from "./markdown-export";
import { yearToDateLabel } from "@/lib/date";
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
  const { ready } = useGoalWidgetItems();
  const goalReadings = useGoalReadings();
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

  async function handleExport() {
    const props = {
      name: me?.name,
      team: me?.team,
      level,
      rangeLabel,
      narrative,
      goalReadings,
      include,
    };
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
      <main className="relative z-[2] px-10 pb-14 pt-9">
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
        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-[26px]">
          <GoalEvidenceBoard
            groups={evidence.groups}
            loading={loading}
            goalsHref={link("/goals")}
          />
          <EvidenceSummary
            rangeLabel={rangeLabel}
            summary={evidence.summary}
            onCompile={() => setView("compile")}
          />
        </div>
      </main>
    );
  }

  // ── Compile view: the goals-only document builder ──
  return (
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <div className="mb-6 no-print">
        <ReviewPrepChecklist />
      </div>
      <PageHeader
        crumb="Evidence · year-to-date goal review"
        title="Make the case."
        italicWord="case"
        subtitle="Compile your goals — what each was set up to achieve, where it landed, and the evidence you logged — into one reviewable document."
        right={
          <div className="flex gap-2 no-print">
            <Button variant="ghost" onClick={() => setView("board")}>
              ← Goals
            </Button>
            <Button size="lg" onClick={handleExport}>
              Export {format === "markdown" ? ".md" : ".pdf"}
            </Button>
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
            rangeLabel={rangeLabel}
          />
        </div>
      </div>
    </main>
  );
}
