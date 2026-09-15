"use client";

/**
 * FIELD BLOCK — one COMPOSED field, rendered as a claim and the proof behind it.
 *
 * The form this replaces was a flat stack in which the question, the answer
 * and the evidence note were all 12.5px grey, one after another. Three
 * consequences, all of them real:
 *
 *   - Evidence read as a footnote, so it went unfilled — and the tier grader
 *     folds `evidence` into the data it judges, so an unbacked tracker gets
 *     judged on bare booleans.
 *   - A checkbox sat at the far right edge, a full row from its own label.
 *   - Controls came in three widths, so the column had no edge to scan.
 *
 * So a field is now ONE object with two halves side by side: what you're
 * claiming, and what backs it. `Answer` and `Proof` are captioned because the
 * pairing is the whole idea — without the captions this is just a two-column
 * layout. The halves collapse to one column on their own (auto-fit) rather
 * than at a page breakpoint, because this renders in a bento tile, a modal
 * and a stepper panel, all of which are different widths at the same viewport.
 *
 * Every answer control sits on `bg-card` inside the `bg-card-alt` block —
 * without that override the primitives' resting fill is the block's own fill
 * and the control disappears. It also makes every answer the same height and
 * the same left edge, which is what actually fixes the ragged column.
 *
 * AUTO FIELDS come out native here, which is the quiet argument for this
 * layout: a repo reading is already a claim ("Present") with its provenance
 * ("RUNBOOK.md in espace/devhub, checked 2h ago") attached. They stop being a
 * different species and slot into the same two halves as everything else.
 *
 * Pure presentation — no store access, no fetching. Callers own the values.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Paperclip } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PROOF } from "../field-status";

/** The 44px filled row every answer control sits in, so the column has one edge. */
export function AnswerRow({ children, className }) {
  return (
    <div
      className={cn(
        "flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-[var(--radius-lg)] bg-card px-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One field: label, kind, and the answer/proof pair.
 *
 * `answer` and `proof` are nodes rather than a `field` prop so the same shell
 * serves a typed field and an auto one — the auto field owns a fetch and a
 * retry, and threading that through a switch here would put a state machine
 * inside a layout component.
 */
export function FieldBlock({
  label,
  optional,
  kind,
  captured,
  answer,
  proof,
  answerCaption = "Answer",
  proofCaption = "Proof",
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg" title={label}>
          {label}
          {optional ? <span className="font-medium text-muted-fg"> optional</span> : null}
        </span>
        {captured ? (
          <span
            className="inline-grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-mint text-mint-ink"
            title="Answered"
            aria-label="Answered"
          >
            <Check size={11} strokeWidth={2.6} />
          </span>
        ) : null}
        {kind ? <span className="shrink-0 text-[11.5px] text-muted-fg">{kind}</span> : null}
      </div>

      {/* auto-fit, not a breakpoint: this block renders at tile width, modal
          width and stepper-panel width, which differ at the same viewport. */}
      <div className="mt-2 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-3 gap-y-2">
        <div className="min-w-0">
          <Label className="mb-1.5 block">{answerCaption}</Label>
          {answer}
        </div>
        {proof ? (
          <div className="min-w-0">
            <Label className="mb-1.5 block">{proofCaption}</Label>
            {proof}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const isUrl = (s) => /^https?:\/\//i.test(String(s).trim());

/**
 * The proof half of a typed field.
 *
 * Four states, and the one that earns its colour is OWED: an answer with
 * nothing behind it, on a field that isn't optional. That gets a lemon
 * button, matching "waiting / needs setup" everywhere else in the system.
 * An unanswered field gets a quiet ghost instead — proof isn't owed for a
 * claim nobody has made yet, and a form that warns before you've done
 * anything wrong is a form people stop reading.
 *
 * Commit contract matches ItemEvidence (Enter saves, Escape reverts, blur
 * saves) so the muscle memory from the check-in editors carries over. This is
 * a separate component rather than a variant of that primitive because
 * ItemEvidence is shared with the milestone widgets and the goal editors,
 * and feature code doesn't edit components/ui.
 */
export function ProofCell({ state, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  // A stepper backfill swaps the period under a mounted cell; without this the
  // draft would still hold the previous period's note.
  const committed = useRef(value || "");
  useEffect(() => {
    committed.current = value || "";
    if (!editing) setDraft(value || "");
  }, [value, editing]);

  function commit() {
    onSave((draft || "").trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(committed.current);
            setEditing(false);
          }
        }}
        onBlur={commit}
        placeholder="note, link, or measured value…"
        aria-label="Proof"
        className="h-11 bg-card text-[13px]"
      />
    );
  }

  if (state === PROOF.HAS) {
    return (
      <div className="flex min-h-[44px] min-w-0 items-center gap-1.5 text-[12.5px] text-muted-fg">
        <Paperclip size={12} className="shrink-0" />
        {isUrl(value) ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            title={value}
            className="min-w-0 truncate text-fg underline"
          >
            {value}
          </a>
        ) : (
          <span className="min-w-0 truncate" title={value}>
            {value}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value || "");
            setEditing(true);
          }}
          className="shrink-0 text-[11.5px] text-muted-fg underline"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[44px] items-center">
      {state === PROOF.OWED ? (
        <Button
          type="button"
          variant="tint"
          tone="lemon"
          size="sm"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          Add proof
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-2.5 text-muted-fg"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          Add a note
        </Button>
      )}
    </div>
  );
}
