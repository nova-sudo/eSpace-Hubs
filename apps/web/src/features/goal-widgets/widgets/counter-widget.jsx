"use client";

import { fmtTarget } from "@/lib/fmt";
import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button, IconButton, Input, Label } from "@/components/ui";
import { WidgetShell } from "../widget-shell";
import { SavedNote, useSavedFlash } from "../saved-note";
import {
  buildCycleWindows,
  cadencePeriodWord,
  cadenceWindowLabel,
  composedCycleBounds,
  computeCompliance,
  thisPeriod,
  useGoalInputs,
} from "@/features/goal-inputs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKS = 8;

/** "2+" for ≥ 2, "2 or fewer" for ≤ 2 — a target in words, no operators. */
function aimWords(op, value) {
  if (op === ">=") return `${value}+`;
  if (op === "<=") return `${value} or fewer`;
  return fmtTarget({ op, value });
}

/** Round to 2 dp so 0.1 + 0.2 reads 0.3. */
function tidy(n) {
  return Math.round(n * 100) / 100;
}

/** "Today" / "This week" / "This quarter" — the shared period words, capitalised. */
function thisPeriodTitle(cadence) {
  if (cadence === "daily") return "Today";
  const phrase = thisPeriod(cadencePeriodWord(cadence));
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Manual "counter" widget — cadence-aware compliance display.
 *
 * Each click appends a timestamped entry to the goal-inputs store. The
 * widget headline now shows COMPLIANCE — the % of cadence windows that
 * met the target — instead of a lifetime sum that would lie about
 * weekly goals (e.g. "log 3h/week" reading "on target" forever after a
 * single 3-hour log).
 *
 * Compliance is computed with PARTIAL CREDIT for windows that came
 * close but missed: a week where the user logged 2/3 hours contributes
 * 0.67 instead of 0. So 9 perfect weeks + 1 week of 2 hours over a
 * 10-week tracking period = (9 + 0.67)/10 = 96.7%, which matches the
 * "I missed by a little, not by a lot" intuition.
 *
 * When there's no target on the spec, or the cadence isn't bucketable
 * (per-incident, milestone, continuous), we fall back to the lifetime
 * total — that surface still exists as a sub-line for context.
 */
export function CounterWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { entries, append, remove } = useGoalInputs(goal?.id);

  const total = useMemo(
    () =>
      entries.reduce((sum, e) => {
        const n = Number(e.value);
        return Number.isFinite(n) ? sum + n : sum;
      }, 0),
    [entries],
  );

  const cadence = spec.manual?.cadence || "weekly";
  const target = spec.manual?.target;
  const compliance = useMemo(
    () => computeCompliance(entries, target, cadence),
    [entries, target, cadence],
  );

  // The window the buttons write into — THIS week/month/quarter — so the
  // big number is what you've logged here, not a lifetime sum that never
  // resets. Non-bucketing cadences (per-incident, continuous) have no such
  // window and keep the lifetime total.
  const current = useMemo(() => {
    const cyc = buildCycleWindows({
      entries,
      cadence,
      now: Date.now(),
      ...composedCycleBounds(spec),
    });
    if (cyc.mode === "pip" || cyc.currentIndex < 0) return null;
    const w = cyc.windows[cyc.currentIndex];
    const inWindow = entries.filter(
      (e) => e.ts >= w.start && e.ts < w.end && Number.isFinite(Number(e.value)),
    );
    return {
      window: w,
      entries: inWindow,
      total: inWindow.reduce((s, e) => s + Number(e.value), 0),
    };
  }, [entries, cadence, spec]);

  const weekly = useMemo(() => weeklyTotals(entries, WEEKS), [entries]);
  const maxW = Math.max(...weekly, 1);
  const promptCopy = spec.manual?.prompt || "Log a count";
  const unit = spec.manual?.unit || "";
  const bigNumber = current ? current.total : total;
  const windowWord = current ? `${thisPeriodTitle(cadence)} (${current.window.label})` : "All time";
  const targetText = target ? ` / ${aimWords(target.op, target.value)}` : "";
  const [saved, flash] = useSavedFlash();
  const [typed, setTyped] = useState("");
  // Confirm what the tap did: "Saved · W40 now 3 / 3+ h".
  const confirmAdd = (n) => {
    append(n);
    const now = tidy((current ? current.total : total) + n);
    const where = current ? `${current.window.label} now` : "Total now";
    flash(`Saved · ${where} ${now}${targetText}${unit ? ` ${unit}` : ""}`);
  };
  const addTyped = () => {
    const n = Number(String(typed).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    confirmAdd(tidy(n));
    setTyped("");
  };
  // "−" removes the last entry logged in this window — a −1 entry would
  // still mark the window as logged (at 0), which isn't what undo means.
  // Cadences with no window (per-incident, continuous, or a cycle that has
  // ended) fall back to the last numeric entry overall — otherwise an
  // over-count there could never be taken back from the widget.
  const lastEntry = useMemo(() => {
    if (current) return current.entries[current.entries.length - 1] ?? null;
    let last = null;
    for (const e of entries) {
      if (!Number.isFinite(Number(e.value))) continue;
      if (!last || e.ts >= last.ts) last = e;
    }
    return last;
  }, [current, entries]);

  const undoLast = () => {
    if (!lastEntry) return;
    remove(lastEntry);
    const n = Number(lastEntry.value) || 0;
    const now = tidy((current ? current.total : total) - n);
    flash(`Removed ${tidy(n)} · ${current ? `${current.window.label} now` : "Total now"} ${now}`);
  };

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Counter · ${cadence.charAt(0).toUpperCase()}${cadence.slice(1)}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <Headline
          compliance={compliance}
          total={total}
          unit={unit}
          target={target}
          cadence={cadence}
          hasWindow={Boolean(current)}
        />
        <Label>{promptCopy}</Label>
        <WeeklyBars data={weekly} max={maxW} />
        <div className="flex items-center gap-2">
          <IconButton
            label={current ? "Remove the last entry logged in this window" : "Remove the last entry logged"}
            size="md"
            onCard
            onClick={undoLast}
            disabled={!lastEntry}
          >
            <Minus size={16} />
          </IconButton>
          <div className="flex flex-1 flex-col items-center gap-0.5">
            <span className="text-[11.5px] font-semibold text-muted-fg">{windowWord}</span>
            <span className="flex items-baseline gap-1">
              <span className="text-[40px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
                {tidy(bigNumber)}
              </span>
              {targetText ? (
                <span className="text-[13px] tabular-nums text-muted-fg">{targetText}</span>
              ) : null}
              {unit ? <span className="text-[13px] text-muted-fg">{unit}</span> : null}
            </span>
          </div>
          <IconButton label="Add one" size="md" onCard onClick={() => confirmAdd(1)}>
            <Plus size={16} />
          </IconButton>
          <IconButton label="Add five" size="md" onCard onClick={() => confirmAdd(5)}>
            <span className="text-[13px] font-extrabold tabular-nums">+5</span>
          </IconButton>
        </div>
        {/* Typed amounts — hours come in halves ("1.5 h"), which +1/+5 can't say. */}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            addTyped();
          }}
        >
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={unit ? `Amount (${unit})` : "Amount"}
            aria-label={unit ? `Amount to add, in ${unit}` : "Amount to add"}
            className="min-w-0 flex-1"
          />
          <Button
            size="sm"
            variant="soft"
            type="submit"
            className="shrink-0"
            disabled={!(Number(String(typed).replace(",", ".")) > 0)}
          >
            Add
          </Button>
        </form>
        <SavedNote message={saved} />
      </div>
    </WidgetShell>
  );
}

/**
 * Headline — two modes:
 *
 *   1. compliance computed  →  big "X%" headline + sub:
 *      "M of N <cadence>s hit 3+ · Y <unit> logged in total"
 *   2. no target / unsupported cadence  →  fall back to lifetime total
 *      (the legacy display)
 */
function Headline({ compliance, total, unit, target, cadence, hasWindow }) {
  if (compliance) {
    const [singular, plural] = cadenceWindowLabel(compliance.cadence);
    const noun = compliance.totalWindows === 1 ? singular : plural;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {compliance.pct}%
          </div>
          <span className="text-[13px] text-muted-fg">
            on target
            {compliance.partial ? " · partial cadence" : ""}
          </span>
        </div>
        <div className="text-[12.5px] text-muted-fg">
          {compliance.metWindows} of {compliance.totalWindows} {noun} hit{" "}
          {aimWords(compliance.targetOp, compliance.targetValue)}
          {unit ? ` ${unit}` : ""}
          {" · "}
          {tidy(total)} {unit ? `${unit} ` : ""}logged in total
        </div>
      </div>
    );
  }

  // The counter below already shows this window's count in large type —
  // a second big number (the lifetime sum) next to it reads as a
  // contradiction. Keep the lifetime figure as a quiet caption instead.
  if (hasWindow) {
    return (
      <div className="text-[12.5px] text-muted-fg">
        {target ? `Aim for ${aimWords(target.op, target.value)}${unit ? ` ${unit}` : ""} per ${cadencePeriodWord(cadence)}` : "No target set"}
        {" · "}
        {tidy(total)} {unit ? `${unit} ` : ""}logged in total
      </div>
    );
  }

  // Legacy fallback — no target or non-bucketable cadence (per-incident /
  // milestone / continuous). Lifetime sum is the right read here.
  return (
    <div className="flex items-baseline gap-2">
      <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
        {tidy(total)}
      </div>
      <span className="text-[13px] text-muted-fg">
        {unit || "total"}
        {target ? ` · aim for ${aimWords(target.op, target.value)}` : ""}
        {cadence ? ` · ${cadence}` : ""}
      </span>
    </div>
  );
}

function weeklyTotals(entries, weeks) {
  const out = new Array(weeks).fill(0);
  const now = Date.now();
  for (const e of entries) {
    const idx = weeks - 1 - Math.floor((now - e.ts) / WEEK_MS);
    if (idx >= 0 && idx < weeks) {
      const n = Number(e.value);
      if (Number.isFinite(n)) out[idx] += n;
    }
  }
  return out;
}

function WeeklyBars({ data, max }) {
  const lastIdx = data.length - 1;
  return (
    <div className="flex items-end gap-1" style={{ height: 28 }}>
      {data.map((v, i) => {
        const h = Math.max(2, (Math.abs(v) / max) * 26);
        const isLast = i === lastIdx;
        return (
          <span
            key={i}
            className={`flex-1 rounded-t-[3px] ${isLast ? "bg-lav" : "bg-card-alt"}`}
            style={{ height: h }}
          />
        );
      })}
    </div>
  );
}
