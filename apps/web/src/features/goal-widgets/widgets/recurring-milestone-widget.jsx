"use client";

import { useMemo, useState } from "react";
import { Checkbox, ItemEvidence } from "@/components/ui";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { useGoalContext, resolveMilestoneItems } from "@/features/goal-context";

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
        <Headline
          pct={pct}
          streak={streak}
          cadence={cadence}
          periodLabel={periodLabel(nowPeriodKey, cadence)}
          variant={variant}
        />
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.18)" : "var(--border)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${pct}%`,
              background: variant === "light" ? "#ffffff" : "var(--accent)",
            }}
          />
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color:
              variant === "light"
                ? "rgba(255,255,255,0.68)"
                : "var(--muted-fg)",
          }}
        >
          {promptCopy}
        </div>
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {items.length === 0 ? (
            <li
              style={{
                color:
                  variant === "light"
                    ? "rgba(255,255,255,0.5)"
                    : "var(--dim-fg)",
              }}
            >
              No items yet — add one below.
            </li>
          ) : null}
          {items.map((it) => (
            <li key={it.id} className="group flex min-w-0 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0">
                  <Checkbox checked={!!it.done} onChange={() => toggle(it.id)} />
                </span>
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    textDecoration: it.done ? "line-through" : "none",
                    color: it.done
                      ? variant === "light"
                        ? "rgba(255,255,255,0.5)"
                        : "var(--dim-fg)"
                      : "inherit",
                  }}
                  title={it.label}
                >
                  {it.label}
                </span>
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  style={{
                    fontSize: 10,
                    color:
                      variant === "light"
                        ? "rgba(255,255,255,0.6)"
                        : "var(--dim-fg)",
                  }}
                  aria-label={`Remove ${it.label}`}
                >
                  ✕
                </button>
              </div>
              <div className="min-w-0 pl-[22px]">
                <ItemEvidence
                  value={it.evidence}
                  variant={variant}
                  onSave={(t) => setEvidence(it.id, t)}
                />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="+ Add item for this period"
            className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              border:
                variant === "light"
                  ? "1px solid rgba(255,255,255,0.22)"
                  : "1px solid var(--border)",
            }}
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="shrink-0 rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-opacity disabled:opacity-40"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.4px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color:
                variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Add
          </button>
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
function Headline({ pct, streak, cadence, periodLabel, variant }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const monoStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: muted,
    lineHeight: 1.4,
  };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <div
          className="shrink-0 font-semibold leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 36,
            letterSpacing: "-1.2px",
          }}
        >
          {pct}%
        </div>
        <div className="min-w-0 truncate" style={monoStyle} title={periodLabel}>
          {periodLabel}
        </div>
      </div>
      <div className="min-w-0 truncate" style={monoStyle}>
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
 * Stable key for the period containing `ts`.
 *
 *   daily      → "YYYY-MM-DD"
 *   weekly     → "YYYY-W##"     (ISO week)
 *   biweekly   → "YYYY-B##"     (paired ISO weeks: floor(week/2))
 *   monthly    → "YYYY-MM"
 *   quarterly  → "YYYY-Q#"
 *
 * Other cadences (per-incident, milestone, continuous) don't have a
 * meaningful period bucket — we collapse them all to "all" so the
 * widget behaves like a non-resetting milestone list. The classifier
 * shouldn't pick these for RECURRING_MILESTONE in the first place
 * (the prompt is explicit) but defensive defaults keep the widget
 * from crashing on legacy specs.
 */
function periodKey(ts, cadence) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "all";
  switch (cadence) {
    case "daily":
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    case "weekly": {
      const [y, w] = isoWeek(d);
      return `${y}-W${pad2(w)}`;
    }
    case "biweekly": {
      const [y, w] = isoWeek(d);
      return `${y}-B${pad2(Math.floor((w - 1) / 2))}`;
    }
    case "monthly":
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    case "quarterly":
      return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    default:
      return "all";
  }
}

/**
 * Step a period key one period backwards. The streak counter walks
 * this until it sees a gap or an incomplete period.
 *
 * Returns null when the key isn't decrementable (e.g. cadence=
 * "continuous"). The caller's loop treats null as a break.
 */
function previousPeriodKey(key, cadence) {
  if (typeof key !== "string" || key === "all") return null;
  if (cadence === "monthly") {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return null;
    let year = Number(m[1]);
    let month = Number(m[2]) - 1; // 0-indexed
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    return `${year}-${pad2(month + 1)}`;
  }
  if (cadence === "quarterly") {
    const m = /^(\d{4})-Q(\d)$/.exec(key);
    if (!m) return null;
    let year = Number(m[1]);
    let q = Number(m[2]);
    q -= 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
    return `${year}-Q${q}`;
  }
  if (cadence === "daily") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  if (cadence === "weekly") {
    const m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!m) return null;
    // Walk back 7d from this week's Thursday (any midweek day works).
    const d = isoWeekDate(Number(m[1]), Number(m[2]));
    d.setUTCDate(d.getUTCDate() - 7);
    const [y, w] = isoWeek(d);
    return `${y}-W${pad2(w)}`;
  }
  if (cadence === "biweekly") {
    const m = /^(\d{4})-B(\d{2})$/.exec(key);
    if (!m) return null;
    let year = Number(m[1]);
    let bucket = Number(m[2]);
    bucket -= 1;
    if (bucket < 0) {
      // Drop to the last bucket of the previous year. There are
      // either 26 or 27 ISO weeks; we use 26 as a coarse default
      // since the streak rarely walks back across a year boundary.
      bucket = 25;
      year -= 1;
    }
    return `${year}-B${pad2(bucket)}`;
  }
  return null;
}

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
      return `this week (${key})`;
    case "biweekly":
      return `this 2-week period (${key})`;
    case "monthly":
      return `this month (${key})`;
    case "quarterly":
      return `this quarter (${key})`;
    default:
      return key;
  }
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * ISO-8601 week. Returns `[year, week]`. The "year" is the ISO week-
 * numbering year (which can differ from the calendar year for
 * Dec/Jan dates near a week boundary).
 *
 * Standard trick: shift the date to the Thursday of its week, then
 * count whole weeks from Jan 4 of that ISO year.
 */
function isoWeek(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return [year, week];
}

/**
 * Inverse — yields a Date for the Thursday of ISO week `w` in year `y`.
 * Used by previousPeriodKey()'s weekly branch so we can step a week
 * back via a normal calendar subtraction.
 */
function isoWeekDate(year, week) {
  // Jan 4 is always in ISO week 1; use it as the anchor.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  // Monday of ISO week 1.
  jan4.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  // Walk `week-1` weeks forward, then to Thursday.
  jan4.setUTCDate(jan4.getUTCDate() + (week - 1) * 7 + 3);
  return jan4;
}
