"use client";

import { useId, useState } from "react";

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
 *
 * Both variants of the widget chrome are supported: `light` is the
 * white-on-accent tile, everything else reads the normal fg/muted tokens.
 */

function palette(variant) {
  const isLight = variant === "light";
  return {
    isLight,
    fg: isLight ? "#ffffff" : "var(--fg)",
    muted: isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
    faint: isLight ? "rgba(255,255,255,0.45)" : "var(--border-strong)",
    rule: isLight ? "rgba(255,255,255,0.22)" : "var(--border)",
    surface: isLight ? "rgba(255,255,255,0.10)" : "var(--card-alt)",
  };
}

const MONO = { fontFamily: "var(--font-mono)", fontSize: 10 };

/** Section heading inside the brief — mono, uppercase, hairline above. */
function Heading({ children, tone }) {
  return (
    <div
      style={{
        ...MONO,
        fontSize: 9,
        letterSpacing: "0.6px",
        textTransform: "uppercase",
        color: tone.faint,
      }}
    >
      {children}
    </div>
  );
}

/**
 * One deliverable: what it is, and — when the document said so — what form it
 * has to take and what counts as done. That second half is the whole point;
 * "documented team norms" without it leaves the user guessing what to hand in.
 */
function Deliverable({ item, tone }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span style={{ ...MONO, fontSize: 10.5, color: tone.fg }}>{item.label}</span>
      {item.format ? (
        <span style={{ ...MONO, fontSize: 9.5, color: tone.muted }}>
          form &middot; {item.format}
        </span>
      ) : null}
      {item.criteria ? (
        <span style={{ ...MONO, fontSize: 9.5, color: tone.muted }}>
          done when &middot; {item.criteria}
        </span>
      ) : null}
    </li>
  );
}

const LEVEL_COLORS = {
  high: "var(--bad)",
  medium: "var(--warn, var(--muted-fg))",
  low: "var(--muted-fg)",
};

/** One risk or note. A risk earns its likelihood/impact chips and mitigation. */
function Note({ note, tone }) {
  const isRisk = note.kind === "risk";
  const levelColor = tone.isLight
    ? tone.fg
    : LEVEL_COLORS[note.likelihood || note.impact] || "var(--muted-fg)";
  return (
    <li
      className="flex flex-col gap-0.5 rounded-[var(--radius-sub)] px-2 py-1.5"
      style={{ background: tone.surface }}
    >
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        <span
          style={{
            ...MONO,
            fontSize: 8.5,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            color: isRisk ? levelColor : tone.faint,
          }}
        >
          {isRisk ? "risk" : "note"}
        </span>
        <span style={{ ...MONO, fontSize: 10.5, color: tone.fg }}>{note.label}</span>
      </div>
      {note.body ? (
        <span style={{ ...MONO, fontSize: 9.5, color: tone.muted }}>{note.body}</span>
      ) : null}
      {note.likelihood || note.impact ? (
        <span style={{ ...MONO, fontSize: 9, color: tone.muted }}>
          {note.likelihood ? `likelihood ${note.likelihood}` : null}
          {note.likelihood && note.impact ? " · " : null}
          {note.impact ? `impact ${note.impact}` : null}
        </span>
      ) : null}
      {note.mitigation ? (
        <span style={{ ...MONO, fontSize: 9.5, color: tone.muted }}>
          mitigation &middot; {note.mitigation}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The small icon that reveals notes without spending any of the widget's
 * vertical budget until someone asks. Renders nothing at all when the spec
 * carries no notes — which is the honest signal that the document had none,
 * rather than an empty panel that looks like a bug.
 */
export function NotesAffordance({ notes, variant, className = "" }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const tone = palette(variant);
  if (!Array.isArray(notes) || notes.length === 0) return null;

  const riskCount = notes.filter((n) => n.kind === "risk").length;
  const label = `${notes.length} ${notes.length === 1 ? "note" : "notes"}${
    riskCount > 0 ? `, ${riskCount} ${riskCount === 1 ? "risk" : "risks"}` : ""
  }`;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? `Hide ${label}` : `Show ${label}`}
        title={label}
        className="inline-flex w-fit items-center gap-1 rounded-[var(--radius-pill)] border px-1.5 py-0.5 transition-colors"
        style={{
          ...MONO,
          fontSize: 9,
          letterSpacing: "0.4px",
          textTransform: "uppercase",
          color: open ? tone.fg : tone.muted,
          borderColor: tone.rule,
          background: open ? tone.surface : "transparent",
          cursor: "pointer",
        }}
      >
        {/* An "i" in a circle — drawn rather than imported, so it inherits the
            variant's colour like every other mark in this tile. */}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <circle cx="5" cy="5" r="4.2" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="5" cy="2.9" r="0.6" fill="currentColor" />
          <path d="M5 4.4v3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        {riskCount > 0 ? `${notes.length} · ${riskCount} risk` : notes.length}
      </button>
      {open ? (
        <ul id={panelId} className="flex list-none flex-col gap-1 p-0">
          {notes.map((n, i) => (
            <Note key={`${n.kind}-${i}`} note={n} tone={tone} />
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
 * suppressed and replaced with a mono chevron to match the rest of the tile.
 */
export function PeriodDetail({ detail, notes, variant, className = "" }) {
  const tone = palette(variant);
  const hasDetail =
    detail &&
    (detail.focus ||
      (detail.activities || []).length > 0 ||
      (detail.deliverables || []).length > 0);
  const periodNotes = Array.isArray(notes) ? notes : [];
  if (!hasDetail && periodNotes.length === 0) return null;

  // Notes but no brief: the icon can stand on its own rather than hiding
  // behind a disclosure whose body would be nothing but the icon.
  if (!hasDetail) {
    return <NotesAffordance notes={periodNotes} variant={variant} className={className} />;
  }

  const summary =
    detail.focus ||
    (detail.deliverables || [])[0]?.label ||
    `${(detail.activities || []).length} activities`;

  return (
    <details
      className={`group ${className}`}
      style={{ borderTop: `1px dashed ${tone.rule}`, paddingTop: 6 }}
    >
      <summary
        className="flex cursor-pointer list-none items-baseline gap-1.5"
        style={{ ...MONO, fontSize: 9.5, color: tone.muted }}
      >
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">
          &rsaquo;
        </span>
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.6px",
            textTransform: "uppercase",
            color: tone.faint,
          }}
        >
          brief
        </span>
        {/* The focus doubles as the collapsed preview — one line of the plan
            is visible without opening anything. */}
        <span className="truncate" style={{ color: tone.muted }}>
          {summary}
        </span>
      </summary>

      <div className="mt-1.5 flex flex-col gap-2">
        {detail.focus ? (
          <div className="flex flex-col gap-0.5">
            <Heading tone={tone}>focus</Heading>
            <span style={{ ...MONO, fontSize: 10.5, color: tone.fg }}>{detail.focus}</span>
          </div>
        ) : null}

        {(detail.activities || []).length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <Heading tone={tone}>activities</Heading>
            <ul className="flex list-none flex-col gap-0.5 p-0">
              {detail.activities.map((a, i) => (
                <li
                  key={`${i}-${a.slice(0, 24)}`}
                  style={{ ...MONO, fontSize: 10, color: tone.muted }}
                >
                  &middot; {a}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {(detail.deliverables || []).length > 0 ? (
          <div className="flex flex-col gap-1">
            <Heading tone={tone}>deliverables</Heading>
            <ul className="flex list-none flex-col gap-1.5 p-0">
              {detail.deliverables.map((d, i) => (
                <Deliverable key={`${i}-${d.label.slice(0, 24)}`} item={d} tone={tone} />
              ))}
            </ul>
          </div>
        ) : null}

        <NotesAffordance notes={periodNotes} variant={variant} />
      </div>
    </details>
  );
}
