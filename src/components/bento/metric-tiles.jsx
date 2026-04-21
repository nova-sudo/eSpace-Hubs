"use client";

import {
  Activity,
  Clock,
  GitMerge,
  Repeat,
  MessageSquare,
  Link2,
  Target,
  Gauge,
  AlertTriangle,
} from "lucide-react";
import { BentoTile, TileMetric } from "./bento-grid";

export function SprintProgressTile() {
  return (
    <BentoTile
      title="Sprint Progress"
      subtitle="Committed vs completed"
      icon={Target}
      colSpan="md:col-span-2"
      rowSpan="row-span-1"
      tone="primary"
    >
      <TileMetric value="—" hint="Wire up Jira agile API to populate" />
    </BentoTile>
  );
}

export function CycleTimeTile() {
  return (
    <BentoTile
      title="Cycle Time"
      subtitle="Avg days In-Progress → Done (30d)"
      icon={Clock}
      colSpan="md:col-span-2"
      rowSpan="row-span-1"
    >
      <TileMetric value="—" hint="Based on status transitions" />
    </BentoTile>
  );
}

export function SlaEvidenceTile() {
  return (
    <BentoTile
      title="Resolution Time by Priority"
      subtitle="L0 / L1 / L2 evidence log"
      icon={AlertTriangle}
      colSpan="md:col-span-2"
      rowSpan="row-span-2"
      tone="warning"
    >
      <div className="flex h-full flex-col justify-center gap-2 text-sm">
        {["L0 / Blocker", "L1 / Critical", "L2 / Major"].map((label) => (
          <div key={label} className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-sm font-semibold tabular-nums">— h</span>
          </div>
        ))}
      </div>
    </BentoTile>
  );
}

export function MergedThisWeekTile() {
  return (
    <BentoTile
      title="MRs Merged"
      subtitle="This week"
      icon={GitMerge}
      colSpan="md:col-span-1"
      rowSpan="row-span-1"
      tone="success"
    >
      <TileMetric value="—" hint="GitLab + GitHub combined" />
    </BentoTile>
  );
}

export function AvgReviewRoundsTile() {
  return (
    <BentoTile
      title="Avg Review Rounds"
      subtitle="Per merged PR (30d)"
      icon={Repeat}
      colSpan="md:col-span-1"
      rowSpan="row-span-1"
    >
      <TileMetric value="—" hint="Lower = cleaner first drafts" />
    </BentoTile>
  );
}

export function ReviewTurnaroundTile() {
  return (
    <BentoTile
      title="Review Turnaround"
      subtitle="Open → first review → merge"
      icon={Gauge}
      colSpan="md:col-span-2"
      rowSpan="row-span-1"
    >
      <TileMetric value="—" hint="Flags slow reviewers" />
    </BentoTile>
  );
}

export function ReviewsGivenTile() {
  return (
    <BentoTile
      title="Reviews Given"
      subtitle="This month"
      icon={MessageSquare}
      colSpan="md:col-span-1"
      rowSpan="row-span-1"
    >
      <TileMetric value="—" hint="Helping teammates counts" />
    </BentoTile>
  );
}

export function TicketMrLinkageTile() {
  return (
    <BentoTile
      title="Ticket ↔ PR Linkage"
      subtitle="Hygiene score"
      icon={Link2}
      colSpan="md:col-span-1"
      rowSpan="row-span-1"
    >
      <TileMetric value="—%" hint="PRs referencing a Jira key" />
    </BentoTile>
  );
}

export function ActivityTile() {
  return (
    <BentoTile
      title="Activity Timeline"
      subtitle="Last 14 days"
      icon={Activity}
      colSpan="md:col-span-4"
      rowSpan="row-span-2"
    >
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Sparkline chart placeholder — wire up once providers are connected.
      </div>
    </BentoTile>
  );
}
