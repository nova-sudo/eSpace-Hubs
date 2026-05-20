"use client";

/**
 * Compact inline editors for the weekly check-in page.
 *
 * Each editor renders the "what did you do for this goal THIS week"
 * input shape, scoped to the active week's [start, end) window. Writes
 * go through `useGoalInputs().append(value, note, ts)` with `ts` set
 * to the mid-week timestamp of the active week — so re-runs of the
 * snapshot capture bucket the entry under the right `cadenceWindow`.
 *
 * One file, multiple editors. Each is small (~30 lines); a separate
 * file per editor would be more ceremony than code. When any of them
 * grows past ~60 lines we'll split.
 *
 * Editors covered in PR #1:
 *   - CounterEditor          (number; sum of entries this week)
 *   - ScaleEditor            (1–5 pills; latest entry this week)
 *   - MilestoneEditor        (checklist; latest checklist snapshot)
 *   - DateLogEditor          (count + add today; entries this week)
 *   - FreeTextEditor         (textarea note for this week)
 *   - BeforeAfterEditor      (baseline + current pair)
 *
 * Read-only displays:
 *   - AutoReadout            (auto-widget metric from integration data)
 *   - UnsupportedStub        (incident / recurring / rubric / scorecard
 *                             for now — full editors in a later PR)
 */

import { useMemo, useState } from "react";
import { Minus, Plus, Check } from "lucide-react";
import { useGoalInputs } from "@/features/goal-inputs";
import { midWeekTs } from "@/lib/date";
import { cn } from "@/lib/cn";

/* ─────────────────────── Counter ─────────────────────── */

export function CounterEditor({ goal, spec, weekStart, weekEnd, activeLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const weekTotal = useMemo(
    () => sumNumericInWindow(entries, weekStart, weekEnd),
    [entries, weekStart, weekEnd],
  );
  const target = spec.manual?.target;
  const unit = spec.manual?.unit || "";

  const add = (delta) => {
    const ts = midWeekTs(activeLabel);
    if (ts == null) return;
    append(delta, undefined, ts);
  };

  return (
    <div className="flex items-center gap-2">
      <ValueChip
        value={weekTotal}
        unit={unit}
        target={target}
        suffix={target ? `${target.op}${target.value}` : null}
      />
      <StepButton onClick={() => add(-1)} aria-label="Subtract 1">
        <Minus size={12} />
      </StepButton>
      <StepButton onClick={() => add(+1)} aria-label="Add 1" primary>
        <Plus size={12} />
      </StepButton>
      <StepButton onClick={() => add(+5)} aria-label="Add 5">
        +5
      </StepButton>
    </div>
  );
}

/* ─────────────────────── Scale (1–5) ─────────────────────── */

export function ScaleEditor({ goal, weekStart, weekEnd, activeLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const currentValue = useMemo(() => {
    const inWindow = entries.filter(
      (e) =>
        e.ts >= weekStart.getTime() &&
        e.ts < weekEnd.getTime() &&
        Number.isFinite(Number(e.value)),
    );
    const latest = inWindow[inWindow.length - 1];
    return latest ? Number(latest.value) : null;
  }, [entries, weekStart, weekEnd]);

  const pick = (n) => {
    const ts = midWeekTs(activeLabel);
    if (ts == null) return;
    append(n, undefined, ts);
  };

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => pick(n)}
          className={cn(
            "h-7 w-7 rounded-md border border-border text-[12px] font-medium transition-colors",
            currentValue === n
              ? "bg-accent text-accent-on"
              : "text-muted-fg hover:bg-accent-dim/60 hover:text-fg",
          )}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────── Milestone (checklist) ─────────────────────── */

export function MilestoneEditor({ goal, spec, weekStart, weekEnd, activeLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  // The widget stores the WHOLE checklist as one entry's value. We take
  // the latest entry (up to and including this week) as the current
  // state, then write a new entry on every toggle.
  const items = useMemo(() => {
    const upToWeek = entries.filter((e) => e.ts <= weekEnd.getTime());
    const latest = upToWeek[upToWeek.length - 1];
    const stored = Array.isArray(latest?.value?.items) ? latest.value.items : null;
    if (stored) return stored;
    // First-time-this-goal: seed from the spec's manual.items (the
    // classifier's authoritative list).
    const seed = Array.isArray(spec.manual?.items) ? spec.manual.items : [];
    return seed.map((it) => ({
      id: it.id || slugify(it.label || it),
      label: it.label || it,
      done: false,
    }));
  }, [entries, weekEnd, spec.manual?.items]);

  const toggle = (id) => {
    const ts = midWeekTs(activeLabel);
    if (ts == null) return;
    const next = items.map((it) =>
      it.id === id ? { ...it, done: !it.done } : it,
    );
    append({ items: next }, undefined, ts);
  };

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] text-muted-fg" style={{ fontFamily: "var(--font-mono)" }}>
        <span>
          {done} / {total} done · {pct}%
        </span>
        {weekStart && (
          <span className="opacity-60">latest snapshot ≤ week-end</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => toggle(it.id)}
            className={cn(
              "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition-colors",
              it.done
                ? "bg-accent-dim text-fg"
                : "text-muted-fg hover:bg-accent-dim/40",
            )}
          >
            {it.done && <Check size={11} />}
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Free-text ─────────────────────── */

export function FreeTextEditor({ goal, weekStart, weekEnd, activeLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const initial = useMemo(() => {
    const inWindow = entries.filter(
      (e) => e.ts >= weekStart.getTime() && e.ts < weekEnd.getTime(),
    );
    const latest = inWindow[inWindow.length - 1];
    return typeof latest?.value === "string" ? latest.value : "";
  }, [entries, weekStart, weekEnd]);

  const [draft, setDraft] = useState(initial);
  const dirty = draft !== initial;

  const save = () => {
    const ts = midWeekTs(activeLabel);
    if (ts == null) return;
    append(draft, undefined, ts);
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Note for this week…"
        className="w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-[12px]"
        style={{ fontFamily: "var(--font-mono)" }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-fg/70">{draft.length} / 500</span>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || draft.length === 0}
          className={cn(
            "rounded-md px-2.5 py-1 text-[10px] uppercase tracking-[0.4px] transition-opacity disabled:opacity-40",
            "bg-accent text-accent-on",
          )}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {dirty ? "Save note" : "Saved"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────── Date-log ─────────────────────── */

export function DateLogEditor({ goal, weekStart, weekEnd, activeLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const weekCount = useMemo(
    () =>
      entries.filter(
        (e) => e.ts >= weekStart.getTime() && e.ts < weekEnd.getTime(),
      ).length,
    [entries, weekStart, weekEnd],
  );

  const add = () => {
    const ts = midWeekTs(activeLabel);
    if (ts == null) return;
    append(true, undefined, ts);
  };

  return (
    <div className="flex items-center gap-2">
      <ValueChip value={weekCount} unit={weekCount === 1 ? "log" : "logs"} />
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] uppercase tracking-[0.4px] text-muted-fg transition-colors hover:bg-accent-dim/60 hover:text-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        <Plus size={11} />
        Log
      </button>
    </div>
  );
}

/* ─────────────────────── Before-after ─────────────────────── */

export function BeforeAfterEditor({ goal, weekStart, weekEnd, activeLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const initial = useMemo(() => {
    const upToWeek = entries.filter((e) => e.ts <= weekEnd.getTime());
    const latest = upToWeek[upToWeek.length - 1];
    const b = Number(latest?.value?.baseline);
    const c = Number(latest?.value?.current);
    return {
      baseline: Number.isFinite(b) ? String(b) : "",
      current: Number.isFinite(c) ? String(c) : "",
    };
  }, [entries, weekEnd]);

  const [draft, setDraft] = useState(initial);
  const dirty = draft.baseline !== initial.baseline || draft.current !== initial.current;

  const save = () => {
    const ts = midWeekTs(activeLabel);
    if (ts == null) return;
    const baseline = Number(draft.baseline);
    const current = Number(draft.current);
    if (!Number.isFinite(baseline) || !Number.isFinite(current)) return;
    append({ baseline, current }, undefined, ts);
  };

  return (
    <div className="flex items-center gap-1.5">
      <NumberField
        value={draft.baseline}
        onChange={(v) => setDraft((d) => ({ ...d, baseline: v }))}
        label="baseline"
      />
      <span className="text-[11px] text-muted-fg">→</span>
      <NumberField
        value={draft.current}
        onChange={(v) => setDraft((d) => ({ ...d, current: v }))}
        label="current"
      />
      <button
        type="button"
        onClick={save}
        disabled={!dirty}
        className="rounded-md px-2 py-1 text-[10px] uppercase tracking-[0.4px] bg-accent text-accent-on transition-opacity disabled:opacity-40"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Save
      </button>
    </div>
  );
}

/* ─────────────────────── Read-only: auto widgets ─────────────────────── */

export function AutoReadout({ value, unit, target, hint }) {
  return (
    <div className="flex items-center gap-2">
      <ValueChip value={value} unit={unit} target={target} suffix={target ? `${target.op}${target.value}` : null} />
      {hint && (
        <span
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/* ─────────────────────── Stub for not-yet-supported kinds ─────────────────────── */

export function UnsupportedStub({ message }) {
  return (
    <div
      className="rounded-md border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-fg/80"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {message || "Edit from the goal widget for now — inline editor coming soon."}
    </div>
  );
}

/* ─────────────────────── primitives ─────────────────────── */

function StepButton({ onClick, children, primary, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-7 items-center justify-center rounded-md border border-border px-1.5 text-[11px] font-medium transition-colors",
        primary
          ? "bg-accent text-accent-on hover:opacity-90"
          : "text-muted-fg hover:bg-accent-dim/60 hover:text-fg",
      )}
      style={{ fontFamily: "var(--font-mono)" }}
      {...rest}
    >
      {children}
    </button>
  );
}

function NumberField({ value, onChange, label }) {
  return (
    <label className="flex items-center gap-1">
      <span
        className="text-[10px] uppercase tracking-[0.4px] text-muted-fg/70"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-16 rounded-md border border-border bg-bg px-1.5 text-[12px]"
        style={{ fontFamily: "var(--font-mono)" }}
      />
    </label>
  );
}

function ValueChip({ value, unit, target, suffix }) {
  const numeric = Number(value);
  const display = Number.isFinite(numeric)
    ? formatNumber(numeric)
    : value == null
    ? "—"
    : String(value);
  const meetsTarget = evalMet(numeric, target);
  return (
    <div
      className={cn(
        "flex items-baseline gap-1 rounded-md border border-border px-2 py-1",
        meetsTarget === true
          ? "border-success/40 bg-success/5"
          : meetsTarget === false
          ? "border-amber/40 bg-amber/5"
          : "bg-bg",
      )}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <span className="text-[13px] font-semibold text-fg">{display}</span>
      {unit && <span className="text-[10px] text-muted-fg">{unit}</span>}
      {suffix && (
        <span className="ml-1 text-[10px] text-muted-fg/70">/ {suffix}</span>
      )}
    </div>
  );
}

/* ─────── helpers ─────── */

function sumNumericInWindow(entries, start, end) {
  if (!Array.isArray(entries)) return 0;
  const s = start.getTime();
  const e = end.getTime();
  let sum = 0;
  for (const entry of entries) {
    if (entry.ts < s || entry.ts >= e) continue;
    const n = Number(entry.value);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

function evalMet(value, target) {
  if (!target || target.value == null || !Number.isFinite(Number(value))) {
    return null;
  }
  const v = Number(value);
  if (target.op === ">=") return v >= target.value;
  if (target.op === "<=") return v <= target.value;
  if (target.op === "=") return Math.abs(v - target.value) < 0.01 * Math.abs(target.value || 1);
  return null;
}

function formatNumber(n) {
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
