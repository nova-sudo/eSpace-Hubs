"use client";

/**
 * Optional inline evidence for a checklist item / period — a short note, a
 * link, or a measured value attached to a milestone item or a filled period.
 *
 * The gap this closes: a checklist item could only carry a binary tick, but
 * achievement-tier criteria routinely demand *documented* proof ("scenario
 * documented, measured RTO/RPO, findings"). With nowhere to put that proof the
 * grader judged a bare boolean and defaulted skeptical. The grader folds
 * `item.evidence` into its currentData, so the verdict rests on real evidence.
 *
 * Lives in components/ui (not a feature) so both the dashboard widgets and the
 * cadence-stepper / check-in editors can render it without a cross-feature
 * import cycle. Evidence is a plain string (`item.evidence`), backward
 * compatible (absent on old entries).
 *
 * `variant="light"` is for use on an ink (dark) tile — text follows
 * `--ink-on` instead of the normal fg/muted tokens.
 */

import { useState } from "react";
import { cn } from "@/lib/cn";

const isUrl = (s) => /^https?:\/\//i.test(String(s).trim());

export function ItemEvidence({ value, onSave, variant = "light" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  const isLight = variant === "light";
  const mutedClass = isLight ? "text-ink-on/65" : "text-muted-fg";
  const fgClass = isLight ? "text-ink-on" : "text-fg";
  const fieldClass = isLight ? "bg-ink-on/10" : "bg-card-alt";

  function commit() {
    onSave((draft || "").trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(value || "");
              setEditing(false);
            }
          }}
          onBlur={commit}
          placeholder="note, link, or measured value…"
          className={cn(
            "min-w-0 flex-1 rounded-[var(--radius-md)] px-2 py-1 text-[12px] outline-none",
            fieldClass,
            fgClass,
          )}
        />
      </div>
    );
  }

  if (value) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5 text-[12px]", mutedClass)}>
        <span className="shrink-0">Evidence:</span>
        {isUrl(value) ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            title={value}
            className={cn("min-w-0 truncate underline", fgClass)}
          >
            {value}
          </a>
        ) : (
          <span title={value} className="min-w-0 truncate">
            {value}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          aria-label="edit evidence"
          className={cn("shrink-0 text-[11.5px]", mutedClass)}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
      className={cn("text-[11.5px]", mutedClass)}
    >
      + Note / link
    </button>
  );
}
