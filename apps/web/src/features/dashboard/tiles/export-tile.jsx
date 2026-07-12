"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
 * Evidence bundle tile (compact-strip variant).
 *
 * Same three actions as before — `.md` download, `.pdf` print-flow, full
 * evidence page — but laid out as a single horizontal row to fit the 1-row
 * grid slot. The decorative dither field and hero text are dropped: at this
 * height they crowd the controls without adding information.
 *
 * Buttons stay accent-on-white so they remain legible against the blue tile,
 * and the inline tag list ("tickets · MRs · …") still tells the user what
 * the bundle contains.
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
          className="font-bold text-[rgba(255,255,255,0.9)] hover:text-white"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          OPEN ↗
        </Link>
      }
    >
      <div className="flex flex-1 items-center justify-between gap-3">
        <div
          className="text-[rgba(255,255,255,0.85)]"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
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
 * White-fill button on the accent-tile background, matching the mock's
 * `.btn-export`. Hover lifts + shadows. Accessible button, not a link.
 * Compact size matches the 1-row strip — narrower padding, no down-arrow.
 */
function ExportButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sub)] border-0 bg-white text-accent transition-all hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(0,0,0,0.15)]"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        padding: "5px 10px",
      }}
    >
      {label}
      <span aria-hidden="true">↓</span>
    </button>
  );
}
