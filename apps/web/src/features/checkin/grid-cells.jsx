"use client";

/**
 * Compact per-cell editors for the catch-up grid.
 *
 * Sized to fit a ~120 × 56px cell. Cells that need more room
 * (milestone checklist, free-text, before-after pair) collapse to a
 * compact preview chip and expand into a Radix popover when clicked.
 *
 * These are the GRID counterparts to the row editors in `editors.jsx`.
 * Sharing one set of editors between the row view and the grid view
 * would have meant ALL of them grow popover behaviour just for the
 * grid case, OR all of them stay inline and the grid breaks visually
 * for milestone/free-text. Keeping the two surfaces as separate
 * components is the smaller diff.
 *
 * All cells write through `useGoalInputs().append(value, note, ts)`
 * with `ts = midWeekTs(weekLabel)` — same path as the row editors and
 * the existing per-widget input UIs.
 */

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Minus, Plus, Check, ChevronDown } from "lucide-react";
import { useGoalInputs } from "@/features/goal-inputs";
import { midWeekTs } from "@/lib/date";
import { cn } from "@/lib/cn";

const CELL_FONT = { fontFamily: "var(--font-mono)" };

/* ─────────────────────── Counter (cell) ─────────────────────── */

export function CounterCell({ goal, weekStart, weekEnd, weekLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const value = useMemo(
    () => sumNumericInWindow(entries, weekStart, weekEnd),
    [entries, weekStart, weekEnd],
  );

  const step = (delta) => {
    const ts = midWeekTs(weekLabel);
    if (ts == null) return;
    append(delta, undefined, ts);
  };

  return (
    <div className="flex items-center gap-0.5">
      <CellStep onClick={() => step(-1)}>
        <Minus size={10} />
      </CellStep>
      <CellValue value={value} />
      <CellStep onClick={() => step(+1)} primary>
        <Plus size={10} />
      </CellStep>
    </div>
  );
}

/* ─────────────────────── Scale (cell) ─────────────────────── */

export function ScaleCell({ goal, weekStart, weekEnd, weekLabel }) {
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
    const ts = midWeekTs(weekLabel);
    if (ts == null) return;
    append(n, undefined, ts);
  };

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => pick(n)}
          className={cn(
            "h-5 w-5 rounded-[3px] border border-border text-[10px] font-medium",
            currentValue === n
              ? "bg-accent text-accent-on"
              : "text-muted-fg hover:bg-accent-dim/50",
          )}
          style={CELL_FONT}
          aria-label={`Rate ${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────── Milestone (cell, popover) ─────────────────────── */

export function MilestoneCell({ goal, spec, weekStart, weekEnd, weekLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const items = useMemo(() => {
    const upToWeek = entries.filter((e) => e.ts <= weekEnd.getTime());
    const latest = upToWeek[upToWeek.length - 1];
    const stored = Array.isArray(latest?.value?.items) ? latest.value.items : null;
    if (stored) return stored;
    const seed = Array.isArray(spec.manual?.items) ? spec.manual.items : [];
    return seed.map((it) => ({
      id: it.id || slugify(it.label || it),
      label: it.label || it,
      done: false,
    }));
  }, [entries, weekEnd, spec.manual?.items]);

  const done = items.filter((i) => i.done).length;
  const total = items.length;

  const toggle = (id) => {
    const ts = midWeekTs(weekLabel);
    if (ts == null) return;
    const next = items.map((it) =>
      it.id === id ? { ...it, done: !it.done } : it,
    );
    append({ items: next }, undefined, ts);
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-[11px] hover:bg-accent-dim/40"
          style={CELL_FONT}
        >
          <span className="font-semibold text-fg">
            {done}/{total}
          </span>
          <ChevronDown size={10} className="text-muted-fg" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-[280px] w-[220px] overflow-y-auto rounded-md border border-border bg-bg p-2 shadow-lg"
        >
          <div className="flex flex-col gap-1">
            {items.length === 0 ? (
              <span
                className="px-1 py-2 text-center text-[11px] text-muted-fg"
                style={CELL_FONT}
              >
                No items in this milestone
              </span>
            ) : (
              items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => toggle(it.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                    it.done
                      ? "bg-accent-dim text-fg"
                      : "text-muted-fg hover:bg-accent-dim/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border",
                      it.done
                        ? "border-accent bg-accent text-accent-on"
                        : "border-border bg-bg",
                    )}
                  >
                    {it.done && <Check size={9} />}
                  </span>
                  <span className="truncate">{it.label}</span>
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─────────────────────── Free-text (cell, popover) ─────────────────────── */

export function FreeTextCell({ goal, weekStart, weekEnd, weekLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const saved = useMemo(() => {
    const inWindow = entries.filter(
      (e) => e.ts >= weekStart.getTime() && e.ts < weekEnd.getTime(),
    );
    const latest = inWindow[inWindow.length - 1];
    return typeof latest?.value === "string" ? latest.value : "";
  }, [entries, weekStart, weekEnd]);

  const [draft, setDraft] = useState(saved);
  const [open, setOpen] = useState(false);

  const onOpenChange = (next) => {
    if (next) setDraft(saved); // reset draft when popover opens
    setOpen(next);
  };

  const onSave = () => {
    if (draft === saved) {
      setOpen(false);
      return;
    }
    const ts = midWeekTs(weekLabel);
    if (ts == null) return;
    append(draft, undefined, ts);
    setOpen(false);
  };

  const preview = saved.trim() || "—";

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "max-w-[180px] truncate rounded-md border border-border bg-bg px-2 py-1 text-left text-[11px]",
            saved ? "text-fg" : "text-muted-fg",
            "hover:bg-accent-dim/40",
          )}
          style={CELL_FONT}
          title={saved || "Add a note"}
        >
          {preview}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[280px] rounded-md border border-border bg-bg p-2 shadow-lg"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Note for this week…"
            className="w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-[12px]"
            style={CELL_FONT}
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[10px] text-muted-fg/70">{draft.length} / 500</span>
            <button
              type="button"
              onClick={onSave}
              className="rounded-md bg-accent px-2 py-1 text-[10px] uppercase tracking-[0.4px] text-accent-on"
              style={CELL_FONT}
            >
              Save
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─────────────────────── Date-log (cell) ─────────────────────── */

export function DateLogCell({ goal, weekStart, weekEnd, weekLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const count = useMemo(
    () =>
      entries.filter(
        (e) => e.ts >= weekStart.getTime() && e.ts < weekEnd.getTime(),
      ).length,
    [entries, weekStart, weekEnd],
  );

  const add = () => {
    const ts = midWeekTs(weekLabel);
    if (ts == null) return;
    append(true, undefined, ts);
  };

  return (
    <div className="flex items-center gap-0.5">
      <CellValue value={count} />
      <CellStep onClick={add} primary>
        <Plus size={10} />
      </CellStep>
    </div>
  );
}

/* ─────────────────────── Before-after (cell, popover) ─────────────────────── */

export function BeforeAfterCell({ goal, weekStart, weekEnd, weekLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const saved = useMemo(() => {
    const upToWeek = entries.filter((e) => e.ts <= weekEnd.getTime());
    const latest = upToWeek[upToWeek.length - 1];
    const b = Number(latest?.value?.baseline);
    const c = Number(latest?.value?.current);
    return {
      baseline: Number.isFinite(b) ? b : null,
      current: Number.isFinite(c) ? c : null,
    };
  }, [entries, weekEnd]);

  const [draft, setDraft] = useState({
    baseline: saved.baseline == null ? "" : String(saved.baseline),
    current: saved.current == null ? "" : String(saved.current),
  });
  const [open, setOpen] = useState(false);

  const onOpenChange = (next) => {
    if (next) {
      setDraft({
        baseline: saved.baseline == null ? "" : String(saved.baseline),
        current: saved.current == null ? "" : String(saved.current),
      });
    }
    setOpen(next);
  };

  const onSave = () => {
    const b = Number(draft.baseline);
    const c = Number(draft.current);
    if (!Number.isFinite(b) || !Number.isFinite(c)) return;
    const ts = midWeekTs(weekLabel);
    if (ts == null) return;
    append({ baseline: b, current: c }, undefined, ts);
    setOpen(false);
  };

  const preview =
    saved.baseline == null && saved.current == null
      ? "—"
      : `${formatNumber(saved.baseline)} → ${formatNumber(saved.current)}`;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-md border border-border bg-bg px-2 py-1 text-[11px]",
            "hover:bg-accent-dim/40",
            saved.baseline == null && saved.current == null ? "text-muted-fg" : "text-fg",
          )}
          style={CELL_FONT}
        >
          {preview}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 flex w-[220px] flex-col gap-1.5 rounded-md border border-border bg-bg p-2 shadow-lg"
        >
          <NumberField
            label="baseline"
            value={draft.baseline}
            onChange={(v) => setDraft((d) => ({ ...d, baseline: v }))}
          />
          <NumberField
            label="current"
            value={draft.current}
            onChange={(v) => setDraft((d) => ({ ...d, current: v }))}
          />
          <button
            type="button"
            onClick={onSave}
            className="mt-1 rounded-md bg-accent px-2 py-1 text-[10px] uppercase tracking-[0.4px] text-accent-on"
            style={CELL_FONT}
          >
            Save
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─────────────────────── Incident log (cell, popover) ─────────────────────── */

export function IncidentLogCell({ goal, spec, weekStart, weekEnd, weekLabel }) {
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

  // Match the dashboard widget's mode inference so the grid cell shows
  // "3" for a defect-count goal instead of "3 · 0m" (which reads as a
  // downtime tally even when nothing was timed).
  const unit = spec?.manual?.unit || "minutes";
  const isCountMode = inferIncidentCellMode(unit) === "count";

  const [severity, setSeverity] = useState("P2");
  const [downtime, setDowntime] = useState("");
  const [link, setLink] = useState("");

  const trimmedDowntime = downtime.trim();
  const minutesValue =
    trimmedDowntime === "" ? null : Number(trimmedDowntime);
  const canLog =
    trimmedDowntime === ""
      ? isCountMode
      : Number.isFinite(minutesValue) && minutesValue >= 0;

  const log = () => {
    if (!canLog) return;
    const ts = midWeekTs(weekLabel);
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

  // Cell preview: count mode shows just the count (the budget is in
  // events, so downtime is a side-detail); duration mode keeps the
  // legacy "N · Tm" form because both numbers are meaningful.
  const preview =
    inWindow.length === 0
      ? "0"
      : isCountMode
        ? String(inWindow.length)
        : `${inWindow.length} · ${totalDowntime}m`;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-md border border-border bg-bg px-2 py-1 text-[11px]",
            "hover:bg-accent-dim/40",
            inWindow.length === 0 ? "text-muted-fg" : "text-fg",
          )}
          style={CELL_FONT}
        >
          {preview}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[280px] rounded-md border border-border bg-bg p-2 shadow-lg"
        >
          {inWindow.length > 0 && (
            <ul className="mb-1.5 flex flex-col gap-0.5">
              {inWindow.map((e) => (
                <li
                  key={e.ts}
                  className="flex items-center justify-between gap-2 rounded-md bg-bg/40 px-1.5 py-0.5 text-[11px]"
                  style={CELL_FONT}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="rounded-[3px] border border-border px-1 py-px text-[9px] uppercase text-muted-fg">
                      {e.value.severity || "P?"}
                    </span>
                    <span className="text-fg">{e.value.downtime ?? 0}m</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(e.ts)}
                    className="text-[10px] text-muted-fg/60 hover:text-fg"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-1" style={CELL_FONT}>
            <select
              value={severity}
              onChange={(ev) => setSeverity(ev.target.value)}
              className="h-7 rounded-md border border-border bg-bg px-1 text-[11px]"
            >
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
              <option value="P4">P4</option>
            </select>
            <input
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
              className="h-7 w-14 rounded-md border border-border bg-bg px-1.5 text-[11px]"
            />
            <input
              type="url"
              value={link}
              onChange={(ev) => setLink(ev.target.value)}
              placeholder="link"
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-1.5 text-[11px]"
            />
            <button
              type="button"
              onClick={log}
              disabled={!canLog}
              className={cn(
                "rounded-md bg-accent px-1.5 py-1 text-[10px] uppercase text-accent-on",
                !canLog && "opacity-40",
              )}
            >
              Log
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─────────────────────── Recurring milestone (cell, popover) ─────────────────────── */

/**
 * RECURRING_MILESTONE — the checklist resets per cadence period. The
 * cell scopes its display to the period the active WEEK falls in
 * (e.g. all weeks of "2026-Q2" share the same checklist state). The
 * write uses `ts = midWeekTs(weekLabel)` so each toggle lives on a
 * known weekday inside the cell's week, but the periodKey it carries
 * is the cadence-level bucket — that's what lets cross-week toggles
 * collapse to one entry.
 */
export function RecurringMilestoneCell({ goal, spec, weekLabel }) {
  const { entries, append } = useGoalInputs(goal?.id);
  const cadence = spec.manual?.cadence || "quarterly";

  const periodKey = useMemo(() => {
    const ts = midWeekTs(weekLabel);
    return ts == null ? "all" : periodKeyFor(ts, cadence);
  }, [weekLabel, cadence]);

  const items = useMemo(() => {
    const matching = (entries || []).filter(
      (e) => e?.value?.periodKey === periodKey,
    );
    const latest = matching[matching.length - 1];
    const stored = Array.isArray(latest?.value?.items) ? latest.value.items : null;
    if (stored) return stored;
    const seed = Array.isArray(spec.manual?.items) ? spec.manual.items : [];
    return seed.map((it) => ({
      id: it.id || slugify(it.label || it),
      label: it.label || it,
      done: false,
    }));
  }, [entries, periodKey, spec.manual?.items]);

  const done = items.filter((i) => i.done).length;
  const total = items.length;

  const toggle = (id) => {
    const ts = midWeekTs(weekLabel);
    if (ts == null) return;
    const next = items.map((it) =>
      it.id === id ? { ...it, done: !it.done } : it,
    );
    append({ periodKey, items: next }, undefined, ts);
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-[11px] hover:bg-accent-dim/40"
          style={CELL_FONT}
        >
          <span className="font-semibold text-fg">
            {done}/{total}
          </span>
          <span className="text-[9px] text-muted-fg/70">{periodKey}</span>
          <ChevronDown size={10} className="text-muted-fg" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-[280px] w-[240px] overflow-y-auto rounded-md border border-border bg-bg p-2 shadow-lg"
        >
          <div className="flex flex-col gap-1">
            {items.length === 0 ? (
              <span
                className="px-1 py-2 text-center text-[11px] text-muted-fg"
                style={CELL_FONT}
              >
                Define items via the dashboard widget first
              </span>
            ) : (
              items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => toggle(it.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] transition-colors",
                    it.done
                      ? "bg-accent-dim text-fg"
                      : "text-muted-fg hover:bg-accent-dim/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border",
                      it.done
                        ? "border-accent bg-accent text-accent-on"
                        : "border-border bg-bg",
                    )}
                  >
                    {it.done && <Check size={9} />}
                  </span>
                  <span className="truncate">{it.label}</span>
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ─────────────────────── Auto / Read-only (cell) ─────────────────────── */

export function AutoCell({ value, unit, target }) {
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
        "inline-flex items-baseline gap-0.5 rounded-md border border-border px-1.5 py-0.5",
        meetsTarget === true
          ? "border-success/40 bg-success/5"
          : meetsTarget === false
          ? "border-amber/40 bg-amber/5"
          : "bg-bg",
      )}
      style={CELL_FONT}
    >
      <span className="text-[11px] font-semibold text-fg">{display}</span>
      {unit && <span className="text-[9px] text-muted-fg">{unit}</span>}
    </div>
  );
}

/* ─────────────────────── Stub (cell) ─────────────────────── */

export function StubCell({ tooltip }) {
  return (
    <span
      className="text-[11px] text-muted-fg/60"
      style={CELL_FONT}
      title={tooltip || "Edit from the dashboard widget"}
    >
      —
    </span>
  );
}

/* ─────────────────────── primitives ─────────────────────── */

function CellStep({ onClick, primary, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-[3px] border border-border transition-colors",
        primary
          ? "bg-accent text-accent-on hover:opacity-90"
          : "text-muted-fg hover:bg-accent-dim/50 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function CellValue({ value }) {
  return (
    <span
      className="min-w-[28px] rounded-[3px] border border-border bg-bg px-1 text-center text-[11px] font-semibold text-fg"
      style={CELL_FONT}
    >
      {Number.isFinite(value) ? value : 0}
    </span>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-1.5">
      <span
        className="w-16 text-[10px] uppercase tracking-[0.4px] text-muted-fg"
        style={CELL_FONT}
      >
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 flex-1 rounded-md border border-border bg-bg px-1.5 text-[12px]"
        style={CELL_FONT}
      />
    </label>
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
  if (!target || target.value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  if (target.op === ">=") return v >= target.value;
  if (target.op === "<=") return v <= target.value;
  if (target.op === "=") return Math.abs(v - target.value) < 0.01 * Math.abs(target.value || 1);
  return null;
}

function formatNumber(n) {
  if (n == null) return "—";
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

/* Period helpers — duplicated from editors.jsx to keep this module
   self-contained for cell-only consumers. Shape matches the dashboard
   RecurringMilestoneWidget's `periodKey`. */

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
  const daysSinceJan1 = Math.floor(
    (d.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000),
  );
  return Math.floor(daysSinceJan1 / 7) + 1;
}

/**
 * Mode inference for the incident-log grid cell. Mirrors the helper
 * in incident-log-widget.jsx and the check-in editor — keep the three
 * DURATION_UNITS sets aligned.
 */
const INCIDENT_CELL_DURATION_UNITS = new Set([
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

function inferIncidentCellMode(unit) {
  if (typeof unit !== "string") return "duration";
  const u = unit.toLowerCase().trim();
  if (INCIDENT_CELL_DURATION_UNITS.has(u)) return "duration";
  return "count";
}
