"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, Checkbox, IconButton, Input, ItemEvidence, Label } from "@/components/ui";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { useGoalContext, resolveMilestoneItems } from "@/features/goal-context";
import {
  recurringPeriodKey as periodKey,
  previousRecurringPeriodKey as previousPeriodKey,
} from "@espace-devhub/shared/goal-specs";

/**
 * Recurring milestone — a milestone checklist that RESETS each
 * cadence period. Headline tracks the streak of complete periods.
 *
 * Storage shape: one input entry per period, value:
 *   { periodKey: string, items: Array<{id, label, done}> }
 *
 * Why one entry per period instead of mutating one big record?
 *   1. The `goal-inputs` store is append-only by design — every save
 *      writes a new entry. Mutating in place would require a
 *      `replace(ts, value)` API that nothing else needs.
 *   2. Keeping one entry per period gives us a free history: "Q1 was
 *      4/4, Q2 was 3/4, Q3 is in progress at 2/4" falls out of the
 *      entry list naturally. The streak widget below is a fold over
 *      that history.
 *
 * Adding / removing items mutates ONLY the current-period entry —
 * older periods stay frozen so the streak calculation is honest.
 *
 * Cadence defaults to "quarterly" if the spec didn't specify; that's
 * the most common reset cadence in practice ("quarterly DR drills",
 * "quarterly succession review"). The classifier's worked example
 * sets it explicitly.
 */
export function RecurringMilestoneWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { entries, append } = useGoalInputs(goal?.id);
  // Phase D bug-fix: same context-driven seed path as MilestoneWidget.
  // Without this, a goal that asked the user to define "what counts"
  // via the ContextCollector (e.g. PDP milestones, DR drill steps)
  // never sees those answers — the widget rendered with the AI's
  // `spec.manual.items` seed (or nothing) and the saved context was
  // silently ignored.
  const { answers: contextAnswers } = useGoalContext(goal?.id);
  const cadence = spec.manual?.cadence || "quarterly";
  // `now` is captured once per render — recomputing the period key
  // every render is fine since users don't sit on this widget across
  // a midnight tick (and if they do, the next interaction re-resolves
  // the period anyway).
  const nowPeriodKey = useMemo(() => periodKey(Date.now(), cadence), [cadence]);

  // Latest entry whose periodKey matches the current period, or null.
  const currentEntry = useMemo(
    () => findLatestForPeriod(entries, nowPeriodKey),
    [entries, nowPeriodKey],
  );

  // The active items list: current period's entry wins (even when empty —
  // an emptied period stays empty); else seed from context answers (the user
  // just defined "what to track"); else fall back to spec.manual.items.
  const items = useMemo(
    () => resolveMilestoneItems(currentEntry?.value?.items, spec, contextAnswers),
    [currentEntry, spec, contextAnswers],
  );

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const [draft, setDraft] = useState("");
  const promptCopy = spec.manual?.prompt || "Tick each item this period";

  const streak = useMemo(
    () => completeStreak(entries, cadence, nowPeriodKey),
    [entries, cadence, nowPeriodKey],
  );

  function writeCurrent(nextItems) {
    append({ periodKey: nowPeriodKey, items: nextItems });
  }

  function toggle(id) {
    const next = items.map((it) =>
      it.id === id ? { ...it, done: !it.done } : it,
    );
    writeCurrent(next);
  }

  function add() {
    const label = draft.trim();
    if (!label) return;
    const next = [
      ...items,
      { id: `m-${Date.now()}`, label, done: false },
    ];
    writeCurrent(next);
    setDraft("");
  }

  function remove(id) {
    const next = items.filter((i) => i.id !== id);
    writeCurrent(next);
  }

  function setEvidence(id, text) {
    const next = items.map((it) =>
      it.id === id ? { ...it, evidence: text || undefined } : it,
    );
    writeCurrent(next);
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`${cadence} · ${done}/${total}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <Headline pct={pct} streak={streak} cadence={cadence} periodLabel={periodLabel(nowPeriodKey, cadence)} />
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-track">
          <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
        </div>
        <Label>{promptCopy}</Label>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto text-[13px]">
          {items.length === 0 ? <li className="text-muted-fg">No items yet — add one below.</li> : null}
          {items.map((it) => (
            <li key={it.id} className="group flex min-w-0 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0">
                  <Checkbox checked={!!it.done} onChange={() => toggle(it.id)} label={it.label || "checklist item"} />
                </span>
                <span
                  className={it.done ? "min-w-0 flex-1 truncate text-muted-fg line-through" : "min-w-0 flex-1 truncate text-fg"}
                  title={it.label}
                >
                  {it.label}
                </span>
                <IconButton
                  label={`Remove ${it.label}`}
                  size="sm"
                  onCard
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => remove(it.id)}
                >
                  <X size={12} />
                </IconButton>
              </div>
              <div className="min-w-0 pl-[26px]">
                <ItemEvidence value={it.evidence} variant="dark" onSave={(t) => setEvidence(it.id, t)} />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="+ Add item for this period"
            className="min-w-0 flex-1"
          />
          <Button size="sm" disabled={!draft.trim()} className="shrink-0" onClick={add}>
            Add
          </Button>
        </div>
      </div>
    </WidgetShell>
  );
}

/**
 * Two-line headline. Top row is the period's % complete; bottom row
 * tells the user the streak so they see the "X periods in a row"
 * cadence pressure that's the whole point of this widget.
 */
function Headline({ pct, streak, cadence, periodLabel }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <div className="shrink-0 text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
          {pct}%
        </div>
        <span className="min-w-0 truncate text-[13px] text-muted-fg" title={periodLabel}>
          {periodLabel}
        </span>
      </div>
      <div className="min-w-0 truncate text-[12.5px] text-muted-fg">
        {streak === 0
          ? `0 ${cadence === "quarterly" ? "quarters" : "periods"} complete in a row`
          : `${streak} ${cadenceNoun(cadence, streak)} complete in a row`}
      </div>
    </div>
  );
}

function cadenceNoun(cadence, n) {
  const plural = n === 1 ? "" : "s";
  switch (cadence) {
    case "daily":
      return `day${plural}`;
    case "weekly":
      return `week${plural}`;
    case "biweekly":
      return `biweekly period${plural}`;
    case "monthly":
      return `month${plural}`;
    case "quarterly":
      return `quarter${plural}`;
    default:
      return `period${plural}`;
  }
}

/**
 * Find the latest entry for the current period. Walks the array
 * BACKWARDS because entries are stored ts-ascending and a user can
 * potentially have multiple writes within one period (every toggle
 * is its own entry); we want the most recent one.
 */
function findLatestForPeriod(entries, key) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.value?.periodKey === key) return entries[i];
  }
  return null;
}

/**
 * Count consecutive complete periods ENDING with the period
 * immediately BEFORE `currentPeriodKey`. The current period itself
 * doesn't count toward the streak — it's "in progress" by definition.
 *
 * A period is complete when EVERY item in its latest entry is done
 * AND there's at least one item. Empty checklists don't count.
 *
 * Implementation:
 *   - Reduce entries → Map<periodKey, latestEntry> (latest wins
 *     because we iterate ascending).
 *   - Step backwards through synthetic period keys generated by
 *     `previousPeriodKey()`, breaking the first time we hit a
 *     missing/incomplete period.
 *
 * We cap the loop at 32 to avoid running away in pathological cases
 * (e.g. malformed periodKey strings that can't be decremented).
 * 32 quarters = 8 years which is more than enough for a real streak.
 */
function completeStreak(entries, cadence, currentKey) {
  const latestByPeriod = new Map();
  for (const e of entries) {
    const k = e?.value?.periodKey;
    if (typeof k === "string") latestByPeriod.set(k, e);
  }
  let count = 0;
  let key = previousPeriodKey(currentKey, cadence);
  for (let i = 0; i < 32; i++) {
    if (!key) break;
    const entry = latestByPeriod.get(key);
    if (!entry) break;
    const items = entry.value?.items;
    if (!Array.isArray(items) || items.length === 0) break;
    const everyDone = items.every((it) => it.done);
    if (!everyDone) break;
    count += 1;
    key = previousPeriodKey(key, cadence);
  }
  return count;
}

// ─── period helpers ────────────────────────────────────────────────

/**
 * Human-readable label for the current period. Used in the headline
 * sub-line so the user knows what "%" they're looking at applies to.
 */
function periodLabel(key, cadence) {
  if (typeof key !== "string") return "this period";
  switch (cadence) {
    case "daily":
      return `today (${key})`;
    case "weekly":
      return `this week (${key.replace(/^\d{4}-/, "")})`;
    case "biweekly":
      return "this 2-week period";
    case "monthly":
      return `this month (${key})`;
    case "quarterly":
      return `this quarter (${key})`;
    default:
      return key;
  }
}
