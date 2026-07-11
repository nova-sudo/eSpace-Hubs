"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button, PageHeader } from "@/components/ui";
import {
  avgReviewerComments,
  countMrComments,
  linkagePct,
  medianTurnaroundDays,
  mergedWithin,
  useCombinedEventsSince,
  useCombinedMergedSince,
  useIntegrations,
} from "@/features/integrations";
import { fmtDurationHours } from "@/features/integrations";
import { useHubLink } from "@/features/hubs";
import { isoDaysAgo } from "@/lib/date";
import { ConfigPanel } from "./config-panel";
import { DocumentPreview } from "./document-preview";
import { EvidencePicker } from "./evidence-picker";
import { ParagraphCard } from "./paragraph-card";
import { ReviewPrepChecklist } from "./review-prep-checklist";
import { useGoalReadings } from "./goal-readings";
import { toggleEvidence, useEvidenceCandidates, useStarredEvidence } from "./use-evidence";
import { downloadMarkdown, rangeToLabel, renderMarkdown } from "./markdown-export";
import { useReceiptsFeed } from "./use-receipts-feed";
import { coverageByL1 } from "./receipt-goal-link";
import { ReceiptsFeed } from "./receipts/receipts-feed";
import { TallySidebar } from "./receipts/tally-sidebar";
import { generateEvidencePdf } from "./pdf/generate-pdf";

export function EvidencePage() {
  const { me } = useIntegrations();
  const searchParams = useSearchParams();
  const [format, setFormat] = useState("markdown");
  const [range, setRange] = useState("90d");
  // "feed" = the receipts timeline (primary); "compile" = the document builder.
  const [view, setView] = useState("feed");
  const link = useHubLink();

  // Deep-link from the dashboard Export tile / command palette: `?print=1` /
  // `?view=compile` opens the document builder directly (real PDF export now
  // lives on the Export button; no auto-print dialog).
  useEffect(() => {
    if (searchParams?.get("print") === "1" || searchParams?.get("view") === "compile") {
      setView("compile");
    }
  }, [searchParams]);
  const [level, setLevel] = useState("L1 → L2");
  // Narrative starts EMPTY. We previously seeded it with sample prose
  // about a fictional payments-platform reliability push, which would
  // ship into a real user's exported review packet if they didn't
  // notice and clear it — confusing at best, embarrassing at worst.
  // The DocumentPreview's textarea already shows a placeholder so the
  // empty-input state isn't blank-and-confusing.
  const [narrative, setNarrative] = useState("");
  const [include, setInclude] = useState({
    narrative: true,
    metrics: true,
    prs: true,
    tickets: true,
    reviews: true,
    goals: true,
  });

  const { data: merged } = useCombinedMergedSince(isoDaysAgo(90));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(90));

  const days = range === "30d" ? 30 : range === "90d" ? 90 : 90;
  const mergedInRange = useMemo(
    () => mergedWithin(merged || [], days),
    [merged, days],
  );

  const metrics = useMemo(
    () => [
      ["Merged PRs", mergedInRange.length, `last ${days}d`],
      ["Review turnaround", fmtDurationHours(medianTurnaroundDays(mergedInRange)), "median"],
      ["Rounds / MR", (avgReviewerComments(mergedInRange) ?? 0).toFixed(1), "reviewer comments", true],
      ["Jira linkage", `${linkagePct(mergedInRange)?.pct ?? 0}%`, "MRs with ticket key"],
      ["Reviews given", countMrComments(events || []), "comments on MRs", false],
    ],
    [mergedInRange, events, days],
  );

  const goalReadings = useGoalReadings(days);
  const feed = useReceiptsFeed(days);
  const coverage = useMemo(() => coverageByL1(goalReadings), [goalReadings]);

  const starred = useStarredEvidence();
  const candidates = useEvidenceCandidates();
  const allPickerItems = useMemo(
    () => [...starred, ...candidates],
    [starred, candidates],
  );
  const starredIds = useMemo(
    () => new Set(starred.map((s) => s.id)),
    [starred],
  );

  const rangeLabel = rangeToLabel(range);

  async function handleExport() {
    const props = {
      name: me?.name,
      team: me?.team,
      level,
      rangeLabel,
      narrative,
      metrics,
      starred,
      goalReadings,
      include,
    };
    if (format === "pdf") {
      const t = toast.loading("Generating PDF…");
      try {
        await generateEvidencePdf(props, `performance-review-${range}.pdf`);
        toast.success("PDF downloaded", { id: t });
      } catch (err) {
        toast.error(`PDF export failed: ${err?.message || err}`, { id: t });
      }
      return;
    }
    downloadMarkdown(`performance-review-${range}.md`, renderMarkdown(props));
    toast.success("Markdown downloaded");
  }

  function handleAutoPick() {
    const top = candidates.slice(0, 10);
    top.forEach((c) => {
      if (!starredIds.has(c.id)) toggleEvidence(c);
    });
    toast.success(`Starred top ${top.length} items`);
  }

  // ── Feed view (primary): "everything you shipped" receipts timeline ──
  if (view === "feed") {
    return (
      <main className="relative z-[2] px-10 pb-14 pt-9">
        <div className="mb-6 no-print">
          <ReviewPrepChecklist />
        </div>
        <PageHeader
          crumb="Evidence · receipts"
          title="Everything you shipped."
          italicWord="."
          right={
            <div className="flex items-center gap-2">
              <RangeToggle range={range} setRange={setRange} />
            </div>
          }
        />
        <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-[26px]">
          <ReceiptsFeed groups={feed.groups} loading={feed.loading} />
          <TallySidebar
            rangeLabel={range}
            tally={feed.tally}
            coverage={coverage}
            onCompile={() => setView("compile")}
          />
        </div>
      </main>
    );
  }

  // ── Compile view: the document builder (reached via "Compile into review →") ──
  return (
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <div className="mb-6 no-print">
        <ReviewPrepChecklist />
      </div>
      <PageHeader
        crumb={`Evidence · ${days}-day performance bundle`}
        title="Make the case."
        italicWord="case"
        subtitle="Turn scattered receipts into one reviewable document. You pick what to include; the data speaks for itself."
        right={
          <div className="flex gap-2 no-print">
            <Button variant="ghost" onClick={() => setView("feed")}>
              ← Receipts
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
            range={range}
            setRange={setRange}
            level={level}
            setLevel={setLevel}
            include={include}
            setInclude={setInclude}
            rangeLabel={rangeLabel}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-[18px]">
          <MetricsRow metrics={metrics} />
          <ParagraphCard
            metrics={metrics}
            rangeLabel={rangeLabel}
            level={level}
            starred={starred}
          />
          <DocumentPreview
            format={format}
            range={range}
            level={level}
            narrative={narrative}
            setNarrative={setNarrative}
            include={include}
            starred={starred}
            metrics={metrics}
            goalReadings={goalReadings}
            rangeLabel={rangeLabel}
          />

          <div className="no-print">
            <EvidencePicker
              items={allPickerItems}
              starredIds={starredIds}
              onToggle={toggleEvidence}
              onAutoPick={handleAutoPick}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

/** Compact 30d / 90d range toggle for the feed header. */
function RangeToggle({ range, setRange }) {
  return (
    <div className="flex overflow-hidden rounded-[var(--radius-sub)] border border-border">
      {["30d", "90d"].map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRange(r)}
          className="px-3 py-1.5 uppercase tracking-[0.6px] transition-colors"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: range === r ? "var(--accent-on)" : "var(--muted-fg)",
            background: range === r ? "var(--accent)" : "transparent",
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/**
 * Five-up headline metric tiles — big Doto numerals over a label + mono
 * sub. Mirrors the reference's metrics strip above the auto-narrative.
 * Reads the same `metrics` tuples [label, value, sub, good] the rest of
 * the page uses.
 */
function MetricsRow({ metrics }) {
  return (
    <div className="grid grid-cols-5 gap-3 no-print">
      {metrics.map(([label, value, sub, good]) => (
        <div
          key={label}
          className="rounded-[9px] border border-border bg-card px-[13px] py-[14px]"
        >
          <div
            className="text-fg"
            style={{
              fontFamily: "var(--font-dot)",
              fontWeight: 900,
              fontSize: 30,
              lineHeight: 0.85,
            }}
          >
            {value}
          </div>
          <div className="mt-[9px] text-[11px] font-semibold text-fg">{label}</div>
          <div
            className="mt-[3px] uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.5px",
              color: good ? "var(--good)" : "var(--dim-fg)",
            }}
          >
            {sub}
          </div>
        </div>
      ))}
    </div>
  );
}
