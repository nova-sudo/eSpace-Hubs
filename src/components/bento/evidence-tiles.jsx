"use client";

import { Camera, Download, Tag } from "lucide-react";
import { BentoTile } from "./bento-grid";
import { toast } from "sonner";

export function WeeklySnapshotTile() {
  return (
    <BentoTile
      title="Weekly Snapshots"
      subtitle="History for review time"
      icon={Camera}
      colSpan="md:col-span-2"
      rowSpan="row-span-1"
      tone="primary"
      action={
        <button
          onClick={() => toast.info("Snapshot saved (stub — will capture current metrics)")}
          className="rounded-md border border-border px-2 py-1 text-[11px] hover:border-primary/40"
        >
          Snapshot now
        </button>
      }
    >
      <div className="flex h-full items-center text-xs text-muted-foreground">
        No snapshots yet. Take one weekly to build a performance history.
      </div>
    </BentoTile>
  );
}

export function EvidenceExportTile() {
  return (
    <BentoTile
      title="Evidence Export"
      subtitle="Markdown / PDF for self-reviews"
      icon={Download}
      colSpan="md:col-span-2"
      rowSpan="row-span-1"
      tone="success"
      action={
        <button
          onClick={() => toast.info("Export coming soon — will package last 90d of activity")}
          className="rounded-md border border-border px-2 py-1 text-[11px] hover:border-primary/40"
        >
          Export 90d
        </button>
      }
    >
      <div className="flex h-full items-center text-xs text-muted-foreground">
        Bundle your tickets, PRs and resolution times into a shareable report.
      </div>
    </BentoTile>
  );
}

export function TaggedEvidenceTile() {
  return (
    <BentoTile
      title="Starred Evidence"
      subtitle="Items tagged for L0/L1/L2 goals"
      icon={Tag}
      colSpan="md:col-span-2"
      rowSpan="row-span-1"
    >
      <div className="flex h-full items-center text-xs text-muted-foreground">
        Star tickets/PRs anywhere in the app to pin them here.
      </div>
    </BentoTile>
  );
}
