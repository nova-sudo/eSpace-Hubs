"use client";

/**
 * One shared goal's analytics: headline numbers, per-period bars, and the
 * people × periods grid (click a cell for what was submitted). Used by the
 * creator (with edit / archive actions passed in via `actions`) and by
 * viewers (read-only).
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Badge, Button, Card, Label, SegmentedControl } from "@/components/ui";
import { setAssignedVerdict, useAssignedProgress } from "./api";
import { CellDetailDialog } from "./cell-detail-dialog";
import { ProgressGrid, TIER_META, fmtDay, fmtStamp } from "./progress-grid";
import { ProgressSummary } from "./progress-summary";

export function AssignedGoalProgress({ goalId, actions = null }) {
  const { progress, loading, error } = useAssignedProgress(goalId);
  const [openCell, setOpenCell] = useState(null);
  const [grading, setGrading] = useState(null); // the assignee being graded

  if (loading && !progress) {
    return <Card><div className="text-[13px] text-muted-fg">Loading progress…</div></Card>;
  }
  if (error || !progress) {
    return (
      <Card>
        <div className="text-[15px] font-bold">Couldn&apos;t load this goal</div>
        <div className="mt-1 text-[13px] text-muted-fg">
          {error?.status === 404 ? "It doesn't exist or isn't shared with you." : error?.message}
        </div>
      </Card>
    );
  }

  const { goal, windows, rows, totals } = progress;
  // min-w-0: this sits in a `1fr` grid track on the manager page, and the
  // people × periods table below has a real min-content width. Without it
  // the track grows to fit the table and the whole page scrolls sideways —
  // the inner overflow-x-auto never gets a chance to do its job.
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card padding={24}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {goal.code ? <span className="font-mono text-[12px] text-muted-fg">{goal.code}</span> : null}
              {goal.status === "archived" ? <Badge>Archived</Badge> : <Badge tone="mint" dot>Active</Badge>}
              {progress.role === "viewer" ? <Badge tone="sky">Shared with you</Badge> : null}
            </div>
            <div className="mt-1 text-[22px] font-extrabold tracking-[-0.02em]">{goal.title}</div>
            <div className="mt-1 text-[13px] text-muted-fg">
              By {goal.createdBy.displayName} · {goal.graceHours ? `${goal.graceHours}h grace` : "no grace period"} ·{" "}
              deadlines in {goal.timeZone} ·
              updated {fmtStamp(Date.parse(progress.generatedAt))}
            </div>
            {goal.description ? (
              <div className="mt-2 max-w-[640px] whitespace-pre-line text-[14px]">{goal.description}</div>
            ) : null}
          </div>
          {actions}
        </div>
        <div className="mt-6 border-t border-line pt-5">
          <ProgressSummary totals={totals} windows={windows} />
        </div>
      </Card>

      <Card padding={24}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[18px] font-bold tracking-[-0.01em]">Who filled what, and when</div>
          {goal.viewers?.length ? (
            <Label>Viewers: {goal.viewers.map((v) => v.displayName).join(", ")}</Label>
          ) : null}
        </div>
        <ProgressGrid
          windows={windows}
          rows={rows}
          onOpenCell={(user, cell) => setOpenCell({ user, cell })}
          verdicts={progress.verdicts || {}}
          onGrade={progress.role === "creator" ? (user) => setGrading(user) : null}
        />
        <div className="mt-3 text-[12px] text-muted-fg">
          Dates show the first save in each period (a “~” means an older entry
          without a save time, so its period date is shown). Deadlines include
          the grace period. Next deadline:{" "}
          {fmtDay(windows.find((w) => w.deadline > Date.now())?.deadline)}.
        </div>
      </Card>

      {grading ? (
        <GradeDialog
          goal={goal}
          user={grading}
          current={progress.verdicts?.[grading.id] ?? null}
          onClose={() => setGrading(null)}
        />
      ) : null}

      {openCell ? (
        <CellDetailDialog
          goal={goal}
          user={openCell.user}
          cell={openCell.cell}
          onClose={() => setOpenCell(null)}
        />
      ) : null}
    </div>
  );
}

const TIER_OPTIONS = ["not_achieved", "achieved", "over_achieved", "role_model"].map((t) => ({
  value: t,
  label: TIER_META[t].label,
}));

/** The creator's grade for one assignee — a manager verdict of record. */
function GradeDialog({ goal, user, current, onClose }) {
  const [tier, setTier] = useState(current?.tier ?? "achieved");
  const [note, setNote] = useState(current?.note ?? "");
  const [saving, setSaving] = useState(false);
  if (typeof document === "undefined") return null;

  async function save() {
    setSaving(true);
    try {
      await setAssignedVerdict(goal.id, user.id, { tier, note });
      toast.success(`Graded ${user.displayName}.`);
      onClose();
    } catch (err) {
      toast.error(err?.message || "Couldn't save the grade.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Grade ${user.displayName}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-fg/40 p-5"
    >
      <div
        className="flex w-full max-w-[560px] flex-col gap-4 rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div>
          <Label>{goal.title}</Label>
          <div className="text-[18px] font-bold tracking-[-0.01em]">Grade {user.displayName}</div>
          <div className="mt-1 text-[13px] text-muted-fg">
            This is a manager grade of record: it outranks the AI tier, and their line
            manager sees it on their board.
          </div>
        </div>
        <div className="overflow-x-auto">
          <SegmentedControl options={TIER_OPTIONS} value={tier} onChange={setTier} size="sm" onCard />
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Why (optional) — they'll see this."
          className="w-full rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3 text-[14px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="ink" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save grade"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
