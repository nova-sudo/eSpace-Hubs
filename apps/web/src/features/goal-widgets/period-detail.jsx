"use client";

import { useId, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Badge, Label } from "@/components/ui";

/**
 * The narrative half of a period — what the source document SAID this window
 * is for, and any risk attached to it.
 *
 * Why this exists: a period could only carry a label, a due date, a prompt and
 * its fields, so "Week 1 — AI orientation" was the entire surviving record of
 * a week whose plan listed a focus, three activities and four named artifacts.
 * Everything else was dropped before it ever reached Mongo. The spec now
 * carries `period.detail` and `period.notes` (see SpecDetail / SpecNote in
 * `@espace-devhub/shared/goal-specs`); this renders them.
 *
 * Two deliberate constraints:
 *
 *   1. COLLAPSED BY DEFAULT. The widget's job is still to be filled in. A
 *      13-week plan's prose would bury the form it sits above, so the brief
 *      opens on demand and the tile keeps its shape until then.
 *   2. NOTHING RENDERS WHEN THERE'S NOTHING. Every pre-existing spec has
 *      neither key, so these components return null and those widgets look
 *      exactly as they did.
 */

/** One deliverable: what it is, and — when the document said so — what form
 *  it has to take and what counts as done. That second half is the whole
 *  point; "documented team norms" without it leaves the user guessing what
 *  to hand in. */
function Deliverable({ item }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-[13px] text-fg">{item.label}</span>
      {item.format ? (
        <span className="text-[12px] text-muted-fg">Form · {item.format}</span>
      ) : null}
      {item.criteria ? (
        <span className="text-[12px] text-muted-fg">Done when · {item.criteria}</span>
      ) : null}
    </li>
  );
}

const RISK_TONE = { high: "peach", medium: "lemon", low: "neutral" };

/** One risk or note. A risk earns its likelihood/impact badge and mitigation. */
function Note({ note }) {
  const isRisk = note.kind === "risk";
  const tone = isRisk ? RISK_TONE[note.likelihood || note.impact] || "neutral" : "neutral";
  return (
    <li className="flex flex-col gap-1 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={tone}>{isRisk ? "Risk" : "Note"}</Badge>
        <span className="text-[13px] font-semibold text-fg">{note.label}</span>
      </div>
      {note.body ? <span className="text-[12px] text-muted-fg">{note.body}</span> : null}
      {note.likelihood || note.impact ? (
        <span className="text-[11.5px] text-muted-fg">
          {note.likelihood ? `Likelihood ${note.likelihood}` : null}
          {note.likelihood && note.impact ? " · " : null}
          {note.impact ? `Impact ${note.impact}` : null}
        </span>
      ) : null}
      {note.mitigation ? (
        <span className="text-[12px] text-muted-fg">Mitigation · {note.mitigation}</span>
      ) : null}
    </li>
  );
}

/**
 * The small toggle that reveals notes without spending any of the widget's
 * vertical budget until someone asks. Renders nothing at all when the spec
 * carries no notes — which is the honest signal that the document had none,
 * rather than an empty panel that looks like a bug.
 */
export function NotesAffordance({ notes, className = "" }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!Array.isArray(notes) || notes.length === 0) return null;

  const riskCount = notes.filter((n) => n.kind === "risk").length;
  const label = `${notes.length} ${notes.length === 1 ? "note" : "notes"}${
    riskCount > 0 ? `, ${riskCount} ${riskCount === 1 ? "risk" : "risks"}` : ""
  }`;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? `Hide ${label}` : `Show ${label}`}
        title={label}
        className={`inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
          open ? "bg-card-alt text-fg" : "text-muted-fg hover:text-fg"
        }`}
      >
        <Info size={12} />
        {riskCount > 0 ? `${notes.length} · ${riskCount} risk` : notes.length}
      </button>
      {open ? (
        <ul id={panelId} className="flex list-none flex-col gap-1.5 p-0">
          {notes.map((n, i) => (
            <Note key={`${n.kind}-${i}`} note={n} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The period brief: focus, activities, deliverables — plus this period's own
 * notes, if it has any.
 *
 * Uses a native <details> so the disclosure is keyboard- and
 * screen-reader-correct without a hand-rolled state machine; the marker is
 * suppressed and replaced with a lucide chevron.
 */
export function PeriodDetail({ detail, notes, className = "" }) {
  const hasDetail =
    detail &&
    (detail.focus ||
      (detail.activities || []).length > 0 ||
      (detail.deliverables || []).length > 0);
  const periodNotes = Array.isArray(notes) ? notes : [];
  if (!hasDetail && periodNotes.length === 0) return null;

  // Notes but no brief: the toggle can stand on its own rather than hiding
  // behind a disclosure whose body would be nothing but the toggle.
  if (!hasDetail) {
    return <NotesAffordance notes={periodNotes} className={className} />;
  }

  const summary =
    detail.focus ||
    (detail.deliverables || [])[0]?.label ||
    `${(detail.activities || []).length} activities`;

  return (
    <details className={`group border-t border-line pt-2.5 ${className}`}>
      <summary className="flex cursor-pointer list-none items-baseline gap-1.5 text-[12.5px] text-muted-fg">
        <ChevronRight size={13} className="shrink-0 transition-transform group-open:rotate-90" />
        <Label as="span">Brief</Label>
        {/* The focus doubles as the collapsed preview — one line of the plan
            is visible without opening anything. */}
        <span className="truncate">{summary}</span>
      </summary>

      <div className="mt-2 flex flex-col gap-2.5">
        {detail.focus ? (
          <div className="flex flex-col gap-0.5">
            <Label>Focus</Label>
            <span className="text-[13px] text-fg">{detail.focus}</span>
          </div>
        ) : null}

        {(detail.activities || []).length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <Label>Activities</Label>
            <ul className="flex list-none flex-col gap-0.5 p-0">
              {detail.activities.map((a, i) => (
                <li key={`${i}-${a.slice(0, 24)}`} className="text-[12.5px] text-muted-fg">
                  · {a}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {(detail.deliverables || []).length > 0 ? (
          <div className="flex flex-col gap-1">
            <Label>Deliverables</Label>
            <ul className="flex list-none flex-col gap-1.5 p-0">
              {detail.deliverables.map((d, i) => (
                <Deliverable key={`${i}-${d.label.slice(0, 24)}`} item={d} />
              ))}
            </ul>
          </div>
        ) : null}

        <NotesAffordance notes={periodNotes} />
      </div>
    </details>
  );
}
