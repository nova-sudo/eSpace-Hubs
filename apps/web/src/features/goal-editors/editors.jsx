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
import { Minus, Plus, Check, X, ArrowRight } from "lucide-react";
import { Select, Input, Button, Label, Badge, ItemEvidence } from "@/components/ui";
import { useGoalInputs } from "@/features/goal-inputs";
import { useGoalContext, resolveMilestoneItems } from "@/features/goal-context";
import { useTierFillFeedback } from "@/features/goal-tiers";
import { midWeekTs } from "@/lib/date";
import { cn } from "@/lib/cn";

/* ─────────────────────── Counter ─────────────────────── */

export function CounterEditor({ goal, spec, weekStart, weekEnd, activeLabel, writeTs }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const { captureBefore, settleAfter } = useTierFillFeedback(goal?.id);
  const weekTotal = useMemo(
    () => sumNumericInWindow(entries, weekStart, weekEnd),
    [entries, weekStart, weekEnd],
  );
  const target = spec.manual?.target;
  const unit = spec.manual?.unit || "";

  const add = (delta) => {
    const ts = writeTs ?? midWeekTs(activeLabel);
    if (ts == null) return;
    // F9 G1.1 — explicit-fill bracket: rapid +1 bursts collapse to one
    // re-grade via the orchestrator's trailing debounce.
    captureBefore();
    append(delta, undefined, ts);
    settleAfter();
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

export function ScaleEditor({ goal, weekStart, weekEnd, activeLabel, writeTs }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const { captureBefore, settleAfter } = useTierFillFeedback(goal?.id);
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
    const ts = writeTs ?? midWeekTs(activeLabel);
    if (ts == null) return;
    // F9 G1.1 — explicit-fill bracket.
    captureBefore();
    append(n, undefined, ts);
    settleAfter();
  };

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => pick(n)}
          className={cn(
            "h-7 w-7 rounded-[var(--radius-pill)] text-[12px] font-bold transition-colors",
            currentValue === n
              ? "bg-ink text-ink-on"
              : "bg-card-alt text-muted-fg hover:text-fg",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────── Milestone (checklist) ─────────────────────── */

export function MilestoneEditor({ goal, spec, weekStart, weekEnd, activeLabel, writeTs }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const { answers: contextAnswers } = useGoalContext(goal?.id);
  // Resolve the SAME way the Goals-page MilestoneWidget does (shared resolver:
  // edited entry → context answers → AI seed) so the two surfaces never show
  // different lists. We bound to this week's snapshot for historical accuracy;
  // for the live (current) week the latest entry is the same one Goals reads.
  const items = useMemo(() => {
    const upToWeek = entries.filter((e) => e.ts <= weekEnd.getTime());
    const latest = upToWeek[upToWeek.length - 1];
    return resolveMilestoneItems(latest?.value?.items, spec, contextAnswers, {
      reseedOnEmpty: true,
    });
  }, [entries, weekEnd, spec, contextAnswers]);

  const write = (next) => {
    const ts = writeTs ?? midWeekTs(activeLabel);
    if (ts == null) return;
    append({ items: next }, undefined, ts);
  };
  const toggle = (id) =>
    write(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const setEvidence = (id, text) =>
    write(
      items.map((it) =>
        it.id === id ? { ...it, evidence: text || undefined } : it,
      ),
    );

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11.5px] text-muted-fg">
        <span>
          {done} / {total} done · {pct}%
        </span>
        {weekStart && <span className="text-dim-fg">latest snapshot ≤ week-end</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((it) => (
          <div key={it.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => toggle(it.id)}
              className={cn(
                "flex w-fit items-center gap-1 rounded-[var(--radius-pill)] px-2.5 py-1 text-[12px] font-semibold transition-colors",
                it.done ? "bg-mint text-mint-ink" : "bg-card-alt text-muted-fg hover:text-fg",
              )}
            >
              {it.done && <Check size={11} />}
              {it.label}
            </button>
            <div className="pl-1">
              <ItemEvidence
                value={it.evidence}
                variant="dark"
                onSave={(t) => setEvidence(it.id, t)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Free-text ─────────────────────── */

export function FreeTextEditor({ goal, weekStart, weekEnd, activeLabel, writeTs }) {
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
    const ts = writeTs ?? midWeekTs(activeLabel);
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
        className="w-full resize-none rounded-[var(--radius-lg)] bg-card-alt p-3 text-[13px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-dim-fg">{draft.length} / 500</span>
        <Button
          size="sm"
          variant={dirty ? "ink" : "soft"}
          onClick={save}
          disabled={!dirty || draft.length === 0}
        >
          {dirty ? "Save note" : "Saved"}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────── Date-log ─────────────────────── */

export function DateLogEditor({ goal, weekStart, weekEnd, activeLabel, writeTs }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const { captureBefore, settleAfter } = useTierFillFeedback(goal?.id);
  const weekCount = useMemo(
    () =>
      entries.filter(
        (e) => e.ts >= weekStart.getTime() && e.ts < weekEnd.getTime(),
      ).length,
    [entries, weekStart, weekEnd],
  );

  const add = () => {
    const ts = writeTs ?? midWeekTs(activeLabel);
    if (ts == null) return;
    // F9 G1.1 — explicit-fill bracket.
    captureBefore();
    append(true, undefined, ts);
    settleAfter();
  };

  return (
    <div className="flex items-center gap-2">
      <ValueChip value={weekCount} unit={weekCount === 1 ? "log" : "logs"} />
      <Button size="sm" variant="soft" onClick={add}>
        <Plus size={12} />
        Log
      </Button>
    </div>
  );
}

/* ─────────────────────── Before-after ─────────────────────── */

export function BeforeAfterEditor({ goal, weekStart, weekEnd, activeLabel, writeTs }) {
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
    const ts = writeTs ?? midWeekTs(activeLabel);
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
        label="Baseline"
      />
      <ArrowRight size={12} className="shrink-0 text-muted-fg" aria-hidden="true" />
      <NumberField
        value={draft.current}
        onChange={(v) => setDraft((d) => ({ ...d, current: v }))}
        label="Current"
      />
      <Button size="sm" variant="ink" onClick={save} disabled={!dirty}>
        Save
      </Button>
    </div>
  );
}

/* ─────────────────────── Incident log ─────────────────────── */

/**
 * INCIDENT_LOG editor — one entry per incident, stored as
 *   { severity, downtime, link? }
 *
 * The check-in single-week view shows ONLY the incidents logged in
 * the active week. A "Log incident" inline form below the list lets
 * the user add a new one with ts = mid-week of the active week.
 *
 * Severity scale matches the dashboard widget: P1 (critical) → P4
 * (minor). The classifier doesn't enforce a specific severity scale
 * so we adopt the most common one.
 */
const SEVERITIES = [
  { id: "P1", label: "P1 · critical" },
  { id: "P2", label: "P2 · major" },
  { id: "P3", label: "P3 · minor" },
  { id: "P4", label: "P4 · low" },
];

export function IncidentLogEditor({ goal, spec, weekStart, weekEnd, activeLabel, writeTs }) {
  const { entries, append, remove } = useGoalInputs(goal?.id);
  const inWindow = useMemo(
    () =>
      (entries || []).filter(
        (e) =>
          e.ts >= weekStart.getTime() &&
          e.ts < weekEnd.getTime() &&
          e.value &&
          typeof e.value === "object",
      ),
    [entries, weekStart, weekEnd],
  );

  const totalDowntime = inWindow.reduce(
    (sum, e) => sum + (Number(e.value?.downtime) || 0),
    0,
  );

  // Mode mirrors the dashboard widget: time-words → duration (minutes
  // required), anything else → count (each Log = +1 event, minutes
  // optional). Keeps the check-in UX honest with how the goal-spec
  // wants the budget to be measured.
  const unit = spec?.manual?.unit || "minutes";
  const isCountMode = inferIncidentEditorMode(unit) === "count";
  const noun = isCountMode ? singularUnit(unit) : "incident";

  const [severity, setSeverity] = useState("P2");
  const [downtime, setDowntime] = useState("");
  const [link, setLink] = useState("");

  const trimmedDowntime = downtime.trim();
  const minutesValue =
    trimmedDowntime === "" ? null : Number(trimmedDowntime);
  // Count mode: blank duration is fine. Duration mode: blank is invalid.
  const canLog =
    trimmedDowntime === ""
      ? isCountMode
      : Number.isFinite(minutesValue) && minutesValue >= 0;

  const log = () => {
    if (!canLog) return;
    const ts = writeTs ?? midWeekTs(activeLabel);
    if (ts == null) return;
    append(
      {
        severity,
        ...(Number.isFinite(minutesValue) && minutesValue >= 0
          ? { downtime: minutesValue }
          : {}),
        ...(link.trim() ? { link: link.trim() } : {}),
      },
      undefined,
      ts,
    );
    setDowntime("");
    setLink("");
  };

  return (
    <div className="flex w-full max-w-[320px] flex-col gap-2">
      <div className="flex items-baseline justify-between text-[11.5px] text-muted-fg">
        <span>
          {inWindow.length} {noun}
          {inWindow.length === 1 ? "" : "s"} this week
        </span>
        {totalDowntime > 0 && <span>Σ {totalDowntime} min downtime</span>}
      </div>

      {inWindow.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-[var(--radius-lg)] bg-card-alt p-1.5">
          {inWindow.map((e) => (
            <li
              key={e.ts}
              className="flex items-center justify-between gap-2 text-[11.5px]"
            >
              <span className="flex items-center gap-1.5">
                <Badge tone="neutral">{e.value.severity || "P?"}</Badge>
                <span className="text-fg">{e.value.downtime ?? 0}m</span>
                {e.value.link && (
                  <a
                    href={e.value.link}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-bold text-fg underline"
                  >
                    link
                  </a>
                )}
              </span>
              <button
                type="button"
                onClick={() => remove(e.ts)}
                className="shrink-0 text-muted-fg hover:text-fg"
                aria-label="Remove incident"
                title="Remove incident"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={severity}
          onChange={(ev) => setSeverity(ev.target.value)}
          tone="default"
          size="sm"
        >
          {SEVERITIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min={0}
          value={downtime}
          onChange={(ev) => setDowntime(ev.target.value)}
          placeholder={isCountMode ? "min (opt)" : "min"}
          aria-label={
            isCountMode
              ? "Duration (optional, minutes)"
              : "Downtime (minutes)"
          }
          className="h-9 w-16 px-2 text-[12.5px]"
        />
        <Input
          type="url"
          value={link}
          onChange={(ev) => setLink(ev.target.value)}
          placeholder="link (optional)"
          className="h-9 min-w-0 flex-1 px-2 text-[12.5px]"
        />
        <Button size="sm" onClick={log} disabled={!canLog}>
          Log
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────── Recurring milestone ─────────────────────── */

/**
 * RECURRING_MILESTONE editor — a checklist that RESETS each period
 * (e.g. quarterly DR drills). Storage shape: one entry per period,
 *   { periodKey, items: [{id, label, done}] }
 *
 * Important: the editor scopes to the PERIOD the active week falls
 * in, NOT the active week itself. A quarterly milestone toggled in
 * W17 reflects in W18, W19, ... up to the quarter boundary — they
 * all share the same period entry. The write uses `ts = midWeekTs`
 * of the active week so the entry lives on a known weekday.
 */
export function RecurringMilestoneEditor({ goal, spec, activeLabel, writeTs }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const { answers: contextAnswers } = useGoalContext(goal?.id);
  const cadence = spec.manual?.cadence || "quarterly";

  // Resolve the active period's key (e.g. "2026-Q2") from the explicit
  // write timestamp (the selected stepper window) or the active-label week.
  const activePeriodKey = useMemo(() => {
    const ts = writeTs ?? midWeekTs(activeLabel);
    return ts == null ? "all" : periodKeyFor(ts, cadence);
  }, [activeLabel, cadence, writeTs]);

  // Resolve identically to the Goals-page RecurringMilestoneWidget (shared
  // resolver: this period's entry → context answers → AI seed) so check-in and
  // Goals never disagree. An emptied period stays empty (no reseedOnEmpty).
  const items = useMemo(() => {
    const matching = (entries || []).filter(
      (e) => e?.value?.periodKey === activePeriodKey,
    );
    const latest = matching[matching.length - 1];
    return resolveMilestoneItems(latest?.value?.items, spec, contextAnswers);
  }, [entries, activePeriodKey, spec, contextAnswers]);

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const write = (next) => {
    const ts = writeTs ?? midWeekTs(activeLabel);
    if (ts == null) return;
    append({ periodKey: activePeriodKey, items: next }, undefined, ts);
  };
  const toggle = (id) =>
    write(items.map((it) => (it.id === id ? { ...it, done: !it.done } : it)));
  const setEvidence = (id, text) =>
    write(
      items.map((it) =>
        it.id === id ? { ...it, evidence: text || undefined } : it,
      ),
    );

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[11.5px] text-muted-fg">
        <span>
          {done} / {total} this {cadenceWord(cadence)} · {pct}%
        </span>
        <span className="text-dim-fg">{activePeriodKey}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.length === 0 ? (
          <span className="text-[11.5px] text-dim-fg">
            No checklist items — define them via the dashboard widget first.
          </span>
        ) : (
          items.map((it) => (
            <div key={it.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => toggle(it.id)}
                className={cn(
                  "flex w-fit items-center gap-1 rounded-[var(--radius-pill)] px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  it.done ? "bg-mint text-mint-ink" : "bg-card-alt text-muted-fg hover:text-fg",
                )}
              >
                {it.done && <Check size={11} />}
                {it.label}
              </button>
              <div className="pl-1">
                <ItemEvidence
                  value={it.evidence}
                  variant="dark"
                  onSave={(t) => setEvidence(it.id, t)}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── Read-only: auto widgets ─────────────────────── */

export function AutoReadout({ value, unit, target, hint }) {
  return (
    <div className="flex items-center gap-2">
      <ValueChip value={value} unit={unit} target={target} suffix={target ? `${target.op}${target.value}` : null} />
      {hint && <span className="text-[11.5px] text-dim-fg">{hint}</span>}
    </div>
  );
}

/* ─────────────────────── Stub for not-yet-supported kinds ─────────────────────── */

export function UnsupportedStub({ message }) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-card-alt px-3 py-2 text-[12px] text-muted-fg">
      {/* Honest copy (audit #238): no inline editor is planned for these
          kinds — composed trackers fill per-period on their own widget,
          which is a design decision, not a pending feature. */}
      {message || "This tracker fills on its own goal widget — open the goal to log."}
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
        "flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-pill)] px-2 text-[12px] font-bold transition-colors",
        primary ? "bg-ink text-ink-on hover:opacity-90" : "bg-card-alt text-muted-fg hover:text-fg",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function NumberField({ value, onChange, label }) {
  return (
    <label className="flex items-center gap-1.5">
      <Label className="shrink-0">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-16 px-2 text-[12.5px]"
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
  const toneClass =
    meetsTarget === true
      ? "bg-mint text-mint-ink"
      : meetsTarget === false
        ? "bg-peach text-peach-ink"
        : "bg-card-alt text-fg";
  return (
    <div className={cn("flex items-baseline gap-1 rounded-[var(--radius-lg)] px-2.5 py-1.5", toneClass)}>
      <span className="text-[13px] font-extrabold tabular-nums">{display}</span>
      {unit && <span className="text-[11px] opacity-80">{unit}</span>}
      {suffix && <span className="text-[11px] opacity-70">/ {suffix}</span>}
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

/**
 * Period key for RECURRING_MILESTONE. Matches the dashboard widget's
 * shape so entries written from the dashboard and from check-in
 * collide on the same key for the same period.
 *
 *   daily      → "YYYY-MM-DD"
 *   weekly     → "YYYY-W##"   (ISO week, simplified — sun-anchored)
 *   biweekly   → "YYYY-B##"
 *   monthly    → "YYYY-MM"
 *   quarterly  → "YYYY-Q#"
 */
function periodKeyFor(ts, cadence) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "all";
  const y = d.getUTCFullYear();
  switch (cadence) {
    case "daily":
      return `${y}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    case "weekly": {
      const w = sunWeekOf(d);
      return `${y}-W${pad2(w)}`;
    }
    case "biweekly": {
      const w = sunWeekOf(d);
      return `${y}-B${pad2(Math.floor((w - 1) / 2))}`;
    }
    case "monthly":
      return `${y}-${pad2(d.getUTCMonth() + 1)}`;
    case "quarterly":
      return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    default:
      return "all";
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function sunWeekOf(d) {
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const daysSinceJan1 = Math.floor((d.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor(daysSinceJan1 / 7) + 1;
}

function cadenceWord(cadence) {
  switch (cadence) {
    case "daily":     return "day";
    case "weekly":    return "week";
    case "biweekly":  return "fortnight";
    case "monthly":   return "month";
    case "quarterly": return "quarter";
    case "yearly":    return "year";
    default:          return "period";
  }
}

/**
 * Mode inference for the IncidentLogEditor — mirrors `inferMode` in
 * the dashboard widget. If you grow either set, sync both files (and
 * the evidence resolver in features/evidence/goal-readings.js).
 */
const INCIDENT_EDITOR_DURATION_UNITS = new Set([
  "minute",
  "minutes",
  "min",
  "mins",
  "m",
  "hour",
  "hours",
  "hr",
  "hrs",
  "h",
  "second",
  "seconds",
  "sec",
  "secs",
  "s",
]);

function inferIncidentEditorMode(unit) {
  if (typeof unit !== "string") return "duration";
  const u = unit.toLowerCase().trim();
  if (INCIDENT_EDITOR_DURATION_UNITS.has(u)) return "duration";
  return "count";
}

function singularUnit(unit) {
  if (typeof unit !== "string" || !unit.trim()) return "incident";
  const u = unit.trim();
  if (/ies$/i.test(u)) return `${u.slice(0, -3)}y`;
  if (/s$/i.test(u)) return u.slice(0, -1);
  return u;
}
