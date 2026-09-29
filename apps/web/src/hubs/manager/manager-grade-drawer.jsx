"use client";

/**
 * Manager grading drawer — set the achievement tier on a report's goal.
 * Writes PUT /manager/reports/:userId/goals/:goalId/verdict, which
 * records the manager verdict (append-only — outranks the AI tier) and
 * notifies the report. Reads …/verdicts for the grade history and the
 * report's "seen" / "I disagree" on the current grade.
 *
 * TWO PANES, not one column: the decision on the left, the evidence on
 * the right. People reference adjacent records while editing one — a
 * single scrolling column made the tier buttons something you had to
 * scroll past the evidence to reach, and pushed the Save button below an
 * unbounded list. Here the decision controls and the footer never move;
 * the evidence scrolls beside them.
 *
 * The left pane reads top to bottom as the decision itself: what the
 * goal is → what the AI said → your rung → what your override costs →
 * your note → where this person stands, and save.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X } from "lucide-react";
import { TIER_ORDER, TIER_LABELS } from "@/features/goal-tiers";
import {
  Badge,
  Button,
  IconButton,
  InsightRow,
  Label,
  SegmentedControl,
  useFocusTrap,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtNumber } from "@/lib/fmt";
import { periodWords } from "@/features/goal-inputs";
import { useGoalDetail } from "./use-goal-detail";
import { useVerdictHistory } from "./use-verdict-history";
import { ManagerGoalReview, RubricNote } from "./manager-goal-review";

import { TierSpreadLegend } from "./manager-ui";
import { saveGoalVerdict } from "./verdict-api";
import { ago, describeAck, goalStatusMeta } from "./manager-format";

const TIER_DESC = {
  not_achieved: "Below the agreed bar for the cycle.",
  achieved: "Met the expectation for the role.",
  over_achieved: "Clearly exceeded the target.",
  role_model: "Set the standard others should follow.",
};

// Ladder tone by tier — not achieved / achieved / exceeds / role model.
const TIER_TONE = {
  not_achieved: "peach",
  achieved: "mint",
  over_achieved: "sky",
  role_model: "lav",
};

const TONE_CLASSES = {
  peach: "bg-peach text-peach-ink",
  mint: "bg-mint text-mint-ink",
  sky: "bg-sky text-sky-ink",
  lav: "bg-lav text-lav-ink",
};

const CONFIDENCE_LABEL = { high: "high", medium: "medium", low: "low" };

// Numbers first: a grade is a judgement on what was logged, so the drawer
// opens on the readings, not on an (often empty) evidence list.
const TABS = [
  { value: "readings", label: "Numbers" },
  { value: "evidence", label: "Evidence" },
  { value: "history", label: "History" },
];

/** Signed rung distance between the AI's suggestion and your pick. */
function rungDelta(from, to) {
  const a = TIER_ORDER.indexOf(from);
  const b = TIER_ORDER.indexOf(to);
  if (a < 0 || b < 0) return 0;
  return b - a;
}

/**
 * The report's acknowledgement of the CURRENT grade: seen (mint),
 * disagrees (peach), or nothing yet. Only shown once a manager grade
 * exists — `ack` is undefined before then.
 */
function AckBadge({ ack, firstName }) {
  if (ack === undefined) return null;
  if (!ack) {
    return <Badge tone="neutral">Not seen yet</Badge>;
  }
  return (
    <Badge tone={ack.disagree ? "peach" : "mint"}>{describeAck(ack, firstName)}</Badge>
  );
}

/**
 * The numbers, first: the shared status, "4 of 6 weeks logged" (due so
 * far — never future weeks) and the total logged, e.g.
 * "Behind · 1 week missed · 4 of 6 weeks logged · 14 h logged in total".
 */
function ReadingHeadline({ goal, detail }) {
  const status = goalStatusMeta(goal);
  const logged = goal?.logged;
  const windows = detail?.windows ?? null;
  const numeric = windows && windows.length > 0 && windows.every((w) => w.total != null);
  const sum = numeric ? windows.reduce((a, w) => a + w.total, 0) : null;
  const unit = windows?.[0]?.unit ?? null;
  const parts = [
    logged && logged.due > 0
      ? `${logged.done} of ${logged.due} ${periodWords(goal?.cadence)[1]} logged`
      : null,
    sum != null ? `${fmtNumber(sum)}${unit ? ` ${unit}` : ""} logged in total` : null,
    goal?.reading ? `${goal.reading} (from their packet)` : null,
  ].filter(Boolean);
  return (
    <div className="mt-4 rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3">
      {goal?.status ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          {status.reason ? (
            <span className="text-[12.5px] text-muted-fg">{status.reason}</span>
          ) : null}
        </div>
      ) : null}
      <div className="text-[14px] font-bold leading-snug text-fg">
        {parts.length > 0 ? parts.join(" · ") : "Nothing logged against this goal yet."}
      </div>
    </div>
  );
}

export function ManagerGradeDrawer({
  open,
  goal,
  userId,
  userName,
  summary,
  onClose,
  onSaved,
}) {
  const [tier, setTier] = useState(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("readings");
  const [showWorkings, setShowWorkings] = useState(false);
  // Whether the manager has touched the note in this session. Until they
  // do, the note stays the server's — see the hydration effect below.
  const noteDirty = useRef(false);
  const trapRef = useFocusTrap(open && !!goal);

  // Read-only goal detail (definition, evidence, verdict history) for the
  // review panel — fetched lazily while the drawer is open.
  const detail = useGoalDetail(userId, goal?.id, open);
  // Every grade ever set on this goal + whether the report has seen /
  // disputed the current one. A re-grade is a CHANGE the report is told
  // about — the manager should see what they're changing from.
  const verdicts = useVerdictHistory(userId, goal?.id, open);

  useEffect(() => {
    if (!open || !goal) return;
    setTier(goal.tier?.tier ?? null);
    setNote(goal.tier?.source === "manager" ? (goal.tier?.reasoning ?? "") : "");
    noteDirty.current = false;
    setSaving(false);
    setTab("readings");
    setShowWorkings(false);
  }, [open, goal]);

  // The note you already wrote is the note you start from. Callers that
  // open the drawer from a queue row (the delegated page) only know the
  // TIER of the existing verdict, not its note — so re-opening used to
  // save an empty note straight over the reasoning the engineer had been
  // given. The detail fetch carries the real note; adopt it as long as
  // nothing has been typed yet.
  useEffect(() => {
    if (!open) return;
    if (noteDirty.current) return;
    const saved = detail.data?.manager?.note;
    if (typeof saved === "string" && saved.length > 0) setNote(saved);
  }, [open, detail.data]);

  // #239: Escape closes (every other overlay in the app does). The element
  // that opened the drawer gets focus back on close via useFocusTrap.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while the drawer is open — it sits over the page,
  // not in the flow, so the page underneath shouldn't scroll.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !goal) return null;
  if (typeof document === "undefined") return null;

  const ai = detail.data?.ai ?? null;
  const aiSuggested =
    ai?.tier ?? (goal.tier?.source === "ai" ? goal.tier.tier : null);
  const aiReasoning = ai?.reasoning ?? (goal.tier?.source === "ai" ? goal.tier.reasoning : null);
  const firstName = (userName || "They").split(" ")[0];
  const delta = aiSuggested && tier ? rungDelta(aiSuggested, tier) : 0;
  const objective = detail.data?.l1?.title ?? null;
  // The grade on file — prefer the history's current row (it carries the
  // real note) over the board's tier. Saving it unchanged would be a
  // no-op server-side, so the button says so instead of pretending.
  const onFile =
    verdicts.current ??
    (goal.tier?.source === "manager"
      ? { tier: goal.tier.tier, note: detail.data?.manager?.note ?? goal.tier.reasoning ?? "" }
      : null);
  const unchanged = Boolean(
    onFile && tier === onFile.tier && (note ?? "") === (onFile.note ?? ""),
  );

  async function save() {
    if (!tier) {
      toast.error("Pick a tier first");
      return;
    }
    setSaving(true);
    const r = await saveGoalVerdict({ userId, goalId: goal.id, tier, note });
    setSaving(false);
    if (r.ok) {
      toast.success(`Graded · ${TIER_LABELS[tier]}`, {
        description: `${firstName} has been notified.`,
      });
      onSaved?.();
    } else {
      toast.error("Couldn't save the grade", {
        description: r.error?.message || "Try again in a moment.",
      });
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Grade ${goal.title}`}
        className="fixed right-0 top-0 z-[61] flex w-[min(1080px,100vw)] flex-col rounded-l-[var(--radius-xl)] bg-card"
        style={{ height: "100dvh", boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start justify-between gap-3 px-6 pb-3 pt-5">
          <div className="min-w-0">
            <Label>Grade · achievement tier</Label>
            <div className="mt-1 text-[12px] text-muted-fg">
              {firstName} · you set the final tier
            </div>
          </div>
          <IconButton label="Close" onCard onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        {/* md+: two independent panes. Narrow: one column that scrolls,
            decision first, evidence under it — the footer stays pinned
            either way. */}
        <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_380px] md:overflow-hidden">
          <div className="min-h-0 px-6 pb-6 md:overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              {goal.kindLabel ? <Badge>{goal.kindLabel}</Badge> : null}
              {objective ? (
                <span className="text-[11.5px] text-muted-fg">{objective}</span>
              ) : null}
            </div>
            <h2 className="mt-1.5 text-[18px] font-bold tracking-[-0.01em] text-fg">
              {goal.title}
            </h2>

            <ReadingHeadline goal={goal} detail={detail.data} />
            {detail.data?.rubric && !detail.data?.spec?.tiers ? (
              <div className="mt-3">
                <Label className="mb-1.5 block">Rubric from their goal sheet</Label>
                <RubricNote rubric={detail.data.rubric} />
              </div>
            ) : null}

            {aiSuggested ? (
              <InsightRow
                tone="lav"
                className="mt-4"
                action={{
                  label: showWorkings ? "Hide workings" : "Show workings",
                  onClick: () => setShowWorkings((s) => !s),
                }}
              >
                <b>AI says {TIER_LABELS[aiSuggested]}</b>
                {ai?.confidence
                  ? ` · ${CONFIDENCE_LABEL[ai.confidence] ?? ai.confidence} confidence`
                  : ""}
                {ai?.gradedAt ? ` · graded ${ago(ai.gradedAt)}` : ""}
              </InsightRow>
            ) : (
              <div className="mt-4 rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3 text-[12.5px] leading-snug text-muted-fg">
                {detail.loading
                  ? "Checking for an AI suggestion…"
                  : detail.data && !detail.data.spec?.tiers
                    ? "No AI suggestion (this goal has no scored levels). Grade from the reading and the rubric."
                    : "No AI suggestion yet — the AI hasn't graded this goal. Grade from the reading and the criteria beside you."}
              </div>
            )}
            {showWorkings && aiReasoning ? (
              <p className="mt-2 rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3 text-[12.5px] leading-relaxed text-fg">
                {aiReasoning}
              </p>
            ) : null}

            <div className="mb-2 mt-5 flex flex-wrap items-center gap-2">
              <Label>Your grade</Label>
              <AckBadge ack={verdicts.current?.ack} firstName={firstName} />
            </div>
            {verdicts.current?.ack?.disagree && verdicts.current.ack.note ? (
              <p className="mb-2 rounded-[var(--radius-lg)] bg-peach px-3.5 py-2.5 text-[12.5px] leading-snug text-peach-ink">
                <b>{firstName} disagrees:</b> {verdicts.current.ack.note}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {TIER_ORDER.map((t) => {
                const active = tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    aria-pressed={active}
                    className={cn(
                      "relative rounded-[var(--radius-lg)] p-3 text-left transition-colors",
                      active ? TONE_CLASSES[TIER_TONE[t]] : "bg-card-alt text-fg",
                    )}
                  >
                    {aiSuggested === t ? (
                      <Badge tone="ink" className="absolute right-2 top-2">
                        AI
                      </Badge>
                    ) : null}
                    <span className="block text-[13px] font-bold">
                      {TIER_LABELS[t]}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-[11px] leading-snug",
                        active ? "opacity-80" : "text-muted-fg",
                      )}
                    >
                      {TIER_DESC[t]}
                    </span>
                  </button>
                );
              })}
            </div>

            {aiSuggested && tier && delta !== 0 ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3">
                <span className="text-[12.5px] text-fg">
                  You are overriding the AI.{" "}
                  <b>
                    Delta {delta > 0 ? "+" : "−"}
                    {Math.abs(delta)} rung{Math.abs(delta) === 1 ? "" : "s"}.
                  </b>
                </span>
                <span className="flex-1" />
                <Button
                  type="button"
                  variant="soft"
                  size="sm"
                  onClick={() => setTier(aiSuggested)}
                >
                  Accept AI verdict instead
                </Button>
              </div>
            ) : null}

            <Label className="mb-2 mt-5 block">
              Note to the engineer{" "}
              <span className="text-muted-fg">(optional)</span>
            </Label>
            <textarea
              value={note}
              onChange={(e) => {
                noteDirty.current = true;
                setNote(e.target.value);
              }}
              placeholder="What earned this tier? They'll see this with the grade."
              className="w-full rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13px] leading-relaxed border border-field-line outline-none focus:ring-2 focus:ring-ink"
              style={{ minHeight: 92, resize: "vertical" }}
            />
          </div>

          <div className="min-h-0 bg-card-alt px-5 pb-6 md:overflow-y-auto">
            <div className="sticky top-0 z-10 bg-card-alt pb-3 pt-1">
              <SegmentedControl ariaLabel="Grade sections"
                options={TABS}
                value={tab}
                onChange={setTab}
                size="sm"
                onCard
                className="w-full"
              />
            </div>
            <ManagerGoalReview
              tab={tab}
              loading={detail.loading}
              error={detail.error}
              data={detail.data}
              verdicts={verdicts}
              firstName={firstName}
            />
          </div>
        </div>

        <div className="border-t border-line px-6 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {summary ? (
              <>
                <span className="text-[12px] text-muted-fg">
                  {firstName} so far:
                </span>
                <TierSpreadLegend byTier={summary.byTier} total={summary.total} />
              </>
            ) : (
              <span className="text-[12px] text-muted-fg">
                {firstName} will be notified and can see your note.
              </span>
            )}
            <span className="flex-1" />
            <Button type="button" variant="soft" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="ink"
              onClick={save}
              disabled={saving || unchanged}
              title={unchanged ? "Nothing changed since the grade on file." : undefined}
            >
              {saving ? "Saving…" : unchanged ? "No changes" : "Save grade"}
            </Button>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}
