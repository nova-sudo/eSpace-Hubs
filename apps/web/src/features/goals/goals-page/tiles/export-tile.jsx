"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Download } from "lucide-react";
import { BentoTile } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";
import {
  downloadMarkdown,
  renderMarkdown,
  useGoalReadings,
} from "@/features/evidence";
import { yearToDateLabel } from "@/lib/date";
import { useHubLink } from "@/features/hubs";

/**
 * Evidence bundle tile (compact-strip variant) — the solid ink accent tile.
 *
 * Same three actions as before — `.md` download, `.pdf` print-flow, full
 * evidence page — laid out as a single horizontal row to fit the 1-row grid
 * slot. Text/buttons use `text-ink-on` / `bg-ink-on` so they invert cleanly
 * with the tile in both themes — never a raw white.
 */
export function ExportTile() {
  const router = useRouter();
  const link = useHubLink();
  const { me } = useIntegrations();
  const goalReadings = useGoalReadings();

  function handleMarkdown() {
    const md = renderMarkdown({
      name: me?.name,
      team: me?.team,
      level: "L1 → L2",
      rangeLabel: yearToDateLabel(),
      narrative: "",
      goalReadings,
      include: { narrative: false, goals: true },
    });
    downloadMarkdown(`performance-review-ytd.md`, md);
    toast.success("Markdown downloaded");
  }

  function handlePdf() {
    toast("Opening the evidence builder — export a PDF from there.");
    router.push(link("/evidence?view=compile"));
  }

  return (
    <BentoTile
      col="span 4"
      row="span 1"
      variant="accent"
      label="Evidence · YTD bundle"
      right={
        <Link
          href={link("/evidence")}
          className="inline-flex items-center gap-1 text-[12px] font-bold text-ink-on"
        >
          Open
          <ArrowUpRight size={12} />
        </Link>
      }
    >
      <div className="flex flex-1 items-center justify-between gap-3">
        <div className="text-[12px] text-ink-on/80">
          goals · readings · logged evidence
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ExportButton onClick={handleMarkdown} label=".md" />
          <ExportButton onClick={handlePdf} label=".pdf" />
        </div>
      </div>
    </BentoTile>
  );
}

/**
 * Inverse-fill button on the ink tile — `bg-ink-on text-ink` flips
 * correctly with the tile in both themes. Compact size matches the
 * 1-row strip.
 */
function ExportButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-ink-on px-2.5 py-1 text-[11px] font-bold text-ink transition-opacity hover:opacity-90"
    >
      {label}
      <Download size={11} aria-hidden="true" />
    </button>
  );
}
