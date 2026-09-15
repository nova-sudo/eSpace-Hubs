"use client";

/**
 * Manager grading drawer — set the achievement tier on a report's goal.
 * Writes PUT /manager/reports/:userId/goals/:goalId/verdict, which
 * upserts the manager verdict (outranks the AI tier) and notifies the
 * report.
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
import { useGoalDetail } from "./use-goal-detail";
import { ManagerGoalReview } from "./manager-goal-review";
import { TierSpreadLegend } from "./manager-ui";
import { saveGoalVerdict } from "./verdict-api";
import { ago } from "./manager-format";

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

const TABS = [
  { value: "evidence", label: "Evidence" },
  { value: "readings", label: "Readings" },
  { value: "history", label: "History" },
];

/** Signed rung distance between the AI's suggestion and your pick. */
function rungDelta(from, to) {
  const a = TIER_ORDER.indexOf(from);
  const b = TIER_ORDER.indexOf(to);
  if (a < 0 || b < 0) return 0;
  return b - a;
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
  const [tab, setTab] = useState("evidence");
  const [showWorkings, setShowWorkings] = useState(false);
  // Whether the manager has touched the note in this session. Until they
  // do, the note stays the server's — see the hydration effect below.
  const noteDirty = useRef(false);
  const trapRef = useFocusTrap(open && !!goal);

  // Read-only goal detail (definition, evidence, verdict history) for the
  // review panel — fetched lazily while the drawer is open.
  const detail = useGoalDetail(userId, goal?.id, open);

  useEffect(() => {
    if (!open || !goal) return;
    setTier(goal.tier?.tier ?? null);
    setNote(goal.tier?.source === "manager" ? (goal.tier?.reasoning ?? "") : "");
    noteDirty.current = false;
    setSaving(false);
    setTab("evidence");
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

  // #239: Escape closes (every other overlay in the app does), and the
  // element that opened the drawer gets focus back on close so keyboard
  // users aren't dropped at the top of the document.
  useEffect(() => {
    if (!open) return undefined;
    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
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
        className="fixed inset-0 z-[60] bg-fg/40"
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
                The AI hasn&apos;t graded this goal yet — not enough logged data
                to suggest a tier. Grade it from the evidence beside you.
              </div>
            )}
            {showWorkings && aiReasoning ? (
              <p className="mt-2 rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3 text-[12.5px] leading-relaxed text-fg">
                {aiReasoning}
              </p>
            ) : null}

            <Label className="mb-2 mt-5 block">Your grade</Label>
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
              <span className="text-dim-fg">(optional)</span>
            </Label>
            <textarea
              value={note}
              onChange={(e) => {
                noteDirty.current = true;
                setNote(e.target.value);
              }}
              placeholder="What earned this tier? They'll see this with the grade."
              className="w-full rounded-[var(--radius-lg)] bg-card-alt p-3.5 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ink"
              style={{ minHeight: 92, resize: "vertical" }}
            />
          </div>

          <div className="min-h-0 bg-card-alt px-5 pb-6 md:overflow-y-auto">
            <div className="sticky top-0 z-10 bg-card-alt pb-3 pt-1">
              <SegmentedControl
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
            <Button type="button" variant="ink" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save grade"}
            </Button>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}
