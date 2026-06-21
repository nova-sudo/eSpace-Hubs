"use client";

import Link from "next/link";
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

export function EvidencePage() {
  const { me } = useIntegrations();
  const searchParams = useSearchParams();
  const [format, setFormat] = useState("markdown");
  const [range, setRange] = useState("90d");
  const link = useHubLink();

  // Deep-link from the dashboard Export tile: `/evidence?print=1` opens this
  // page with the browser print dialog auto-triggered on first render. We
  // delay a beat so the document preview has time to mount and SWR has a
  // chance to fill in the metric numbers (otherwise the PDF shows dashes).
  useEffect(() => {
    if (searchParams?.get("print") !== "1") return;
    const t = setTimeout(() => window.print(), 900);
    return () => clearTimeout(t);
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

  function handleExport() {
    if (format === "pdf") {
      window.print();
      return;
    }
    const md = renderMarkdown({
      name: me?.name,
      team: me?.team,
      level,
      rangeLabel,
      narrative,
      metrics,
      starred,
      goalReadings,
      include,
    });
    downloadMarkdown(`performance-review-${range}.md`, md);
    toast.success("Markdown downloaded");
  }

  function handleAutoPick() {
    const top = candidates.slice(0, 10);
    top.forEach((c) => {
      if (!starredIds.has(c.id)) toggleEvidence(c);
    });
    toast.success(`Starred top ${top.length} items`);
  }

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
            <Link href={link("")}>
              <Button variant="ghost">← Dashboard</Button>
            </Link>
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
