/**
 * Plan model — the pure logic behind the plan editor.
 *
 * A COMPOSED tracker's `composed` block describes a plan: a cadence, a
 * cycle (start + length), optional per-period content, and optionally a
 * second cadence nested inside each period. The editor lets the user SEE
 * that plan as the windows it will actually produce, correct the cycle the
 * AI guessed (the recurring bug: a 13-week plan rendered as the calendar
 * year's 53 weekly cells), and move the document's activities and
 * deliverables between windows until the map matches the plan.
 *
 * Everything here is a pure function over a composed block — no React, no
 * IO. Every mutator returns a NEW block (structural sharing where untouched)
 * so the editor can hold the block in state and diff it against the saved
 * one. Blocks are cadence-level generic: the same functions edit the top
 * level, a period's `nested` block, and the `management` block, which is what
 * lets the editor recurse without a second code path.
 *
 * Cycle resolution (`resolvePlanBounds`) is the one piece with real
 * judgement in it. Its precedence mirrors what the widget/stepper will do
 * with the saved block, and it reports WHERE the start and length came from
 * so the editor can say "this is the calendar-year default, not your plan"
 * instead of silently rendering 53 cells.
 */

import { buildCycleWindows, toIsoDay } from "@/features/goal-inputs";
import {
  COMPOSED_MAX_PERIODS,
  DETAIL_MAX_ACTIVITIES,
  DETAIL_MAX_DELIVERABLES,
  NOTES_MAX,
  cycleEndForCount,
  snapCycleStart,
  windowCountForCycle,
} from "@/features/goal-specs";

const DAY = 86_400_000;

/** The cadences that bucket a cycle into windows — the only ones a plan can be mapped onto. */
export const PLAN_CADENCES = Object.freeze(["daily", "weekly", "biweekly", "monthly", "quarterly"]);

const CADENCE_NOUN = Object.freeze({
  daily: "Day",
  weekly: "Week",
  biweekly: "Sprint",
  monthly: "Month",
  quarterly: "Quarter",
});

const KEY_PREFIX = Object.freeze({
  daily: "d",
  weekly: "w",
  biweekly: "b",
  monthly: "m",
  quarterly: "q",
});

export function isPlanCadence(cadence) {
  return PLAN_CADENCES.includes(cadence);
}

/** "Week 3", "Month 1", "Quarter 2" — the placeholder label for an unauthored period. */
export function periodLabelFor(cadence, n) {
  return `${CADENCE_NOUN[cadence] || "Period"} ${n}`;
}

/** Plural noun for a count of windows: "weekly windows" reads worse than "weeks". */
export function cadenceNoun(cadence, count) {
  const noun = (CADENCE_NOUN[cadence] || "period").toLowerCase();
  return count === 1 ? noun : `${noun}s`;
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function clampCount(n) {
  if (!Number.isInteger(n)) return null;
  return Math.min(COMPOSED_MAX_PERIODS, Math.max(1, n));
}

// ─── cycle resolution ─────────────────────────────────────────────────

/**
 * Where does this block's cycle start, how long is it, and which windows does
 * that produce?
 *
 * Start precedence: the block's own `cycleStart` → the goal's `startDate`
 * (top level only) → the containing window (nested blocks) → the first day
 * of the cadence period containing `now`.
 *
 * Length precedence: authored periods (structural) → `periodCount` →
 * `cycleEnd` → the containing window (nested) → a full year from the start,
 * capped at the period ceiling. That last one is the legacy calendar-year
 * behaviour and is reported as `lengthSource: "default"` so the editor can
 * flag it — it is almost never the plan the user meant.
 *
 * @returns {null | {
 *   cadence: string, cycleStart: string, cycleEnd: string, periodCount: number,
 *   windows: Array<{start:number,end:number,key:string,label:string}>,
 *   startSource: "spec"|"goal"|"container"|"today",
 *   lengthSource: "periods"|"spec"|"container"|"default",
 * }}
 */
export function resolvePlanBounds(block, opts = {}) {
  const cadence = block?.cadence;
  if (!isPlanCadence(cadence)) return null;
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const goalStart = toIsoDay(opts.goal?.startDate);
  const containerStart =
    typeof opts.containerStart === "number" ? isoDay(opts.containerStart) : null;
  const containerEndInclusive =
    typeof opts.containerEnd === "number" ? isoDay(opts.containerEnd - DAY) : null;

  let cycleStart;
  let startSource;
  const specStart = toIsoDay(block.cycleStart);
  if (specStart) {
    cycleStart = specStart;
    startSource = "spec";
  } else if (goalStart) {
    cycleStart = goalStart;
    startSource = "goal";
  } else if (containerStart) {
    cycleStart = containerStart;
    startSource = "container";
  } else {
    cycleStart = snapCycleStart(cadence, now);
    startSource = "today";
  }

  let periodCount = null;
  let lengthSource;
  const authored = Array.isArray(block.periods) ? block.periods.length : 0;
  const specEnd = toIsoDay(block.cycleEnd);
  if (authored > 0) {
    periodCount = clampCount(authored);
    lengthSource = "periods";
  } else if (clampCount(block.periodCount)) {
    periodCount = clampCount(block.periodCount);
    lengthSource = "spec";
  } else if (specStart && specEnd && windowCountForCycle(specStart, cadence, specEnd)) {
    periodCount = clampCount(windowCountForCycle(specStart, cadence, specEnd));
    lengthSource = "spec";
  } else if (
    containerEndInclusive &&
    windowCountForCycle(cycleStart, cadence, containerEndInclusive)
  ) {
    periodCount = clampCount(windowCountForCycle(cycleStart, cadence, containerEndInclusive));
    lengthSource = "container";
  } else {
    const s = new Date(Date.parse(cycleStart));
    const yearOut = isoDay(
      Date.UTC(s.getUTCFullYear() + 1, s.getUTCMonth(), s.getUTCDate()) - DAY,
    );
    periodCount = clampCount(windowCountForCycle(cycleStart, cadence, yearOut) || 1);
    lengthSource = "default";
  }

  const cycleEnd = cycleEndForCount(cycleStart, cadence, periodCount);
  const startMs = Date.parse(cycleStart);
  const cycle = buildCycleWindows({
    entries: [],
    cadence,
    now,
    cycleStart: startMs,
    cycleEnd: Date.parse(cycleEnd) + DAY,
  });
  return {
    cadence,
    cycleStart,
    cycleEnd,
    periodCount,
    windows: cycle.windows || [],
    startSource,
    lengthSource,
  };
}

/**
 * Write the resolved cycle onto the block so what the user reviewed is
 * exactly what gets saved — explicit `cycleStart`/`cycleEnd`, plus
 * `periodCount` for a flat block (the validator drops it beside periods).
 */
export function stampBounds(block, bounds) {
  if (!bounds) return block;
  const out = { ...block, cycleStart: bounds.cycleStart, cycleEnd: bounds.cycleEnd };
  if (Array.isArray(block?.periods) && block.periods.length > 0) {
    delete out.periodCount;
  } else {
    out.periodCount = bounds.periodCount;
  }
  return out;
}

/** "13 weeks · 1 Sep – 30 Nov 2026" */
export function describeCycle(bounds) {
  if (!bounds) return "";
  return `${bounds.periodCount} ${cadenceNoun(bounds.cadence, bounds.periodCount)} · ${formatRange(bounds.cycleStart, bounds.cycleEnd)}`;
}

const SHORT = { day: "numeric", month: "short", timeZone: "UTC" };
const SHORT_YEAR = { ...SHORT, year: "numeric" };

export function formatDay(iso, withYear = true) {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString("en-GB", withYear ? SHORT_YEAR : SHORT);
}

export function formatRange(startIso, endIso) {
  const sameYear = String(startIso).slice(0, 4) === String(endIso).slice(0, 4);
  return `${formatDay(startIso, !sameYear)} – ${formatDay(endIso, true)}`;
}

// ─── cycle mutators ───────────────────────────────────────────────────

export function setCadence(block, cadence, bounds) {
  if (!isPlanCadence(cadence) || cadence === block?.cadence) return block;
  const count = bounds?.periodCount ?? currentCount(block);
  const start = toIsoDay(block?.cycleStart) || bounds?.cycleStart || null;
  const out = { ...block, cadence };
  if (start) {
    out.cycleStart = start;
    const end = cycleEndForCount(start, cadence, count);
    if (end) out.cycleEnd = end;
  }
  if (!hasPeriods(block)) out.periodCount = count;
  return out;
}

export function setCycleStart(block, iso, bounds) {
  const start = toIsoDay(iso);
  if (!start) return block;
  const count = bounds?.periodCount ?? currentCount(block);
  const out = { ...block, cycleStart: start };
  const end = cycleEndForCount(start, block.cadence, count);
  if (end) out.cycleEnd = end;
  return out;
}

/**
 * Change the plan's length. Authored periods are padded with placeholders or
 * trimmed — and a trimmed period's content is folded into the last surviving
 * one rather than dropped, because "shorten the cycle" must never silently
 * delete part of the document. A flat block just records the count.
 */
export function setPeriodCount(block, n, bounds) {
  const count = clampCount(n);
  if (!count) return block;
  const start = toIsoDay(block?.cycleStart) || bounds?.cycleStart || null;
  let out = { ...block };
  if (hasPeriods(block)) {
    const periods = block.periods.slice();
    if (periods.length > count) {
      const kept = periods.slice(0, count);
      const dropped = periods.slice(count);
      let last = kept[count - 1];
      for (const p of dropped) last = mergePeriodContent(last, p);
      kept[count - 1] = last;
      out.periods = kept;
    } else if (periods.length < count) {
      const keys = new Set(periods.map((p) => p.key));
      for (let i = periods.length; i < count; i += 1) {
        periods.push(placeholderPeriod(block.cadence, i + 1, keys));
      }
      out.periods = periods;
    }
    delete out.periodCount;
  } else {
    out.periodCount = count;
  }
  if (start) {
    out.cycleStart = start;
    const end = cycleEndForCount(start, block.cadence, count);
    if (end) out.cycleEnd = end;
  }
  return out;
}

function hasPeriods(block) {
  return Array.isArray(block?.periods) && block.periods.length > 0;
}

function currentCount(block) {
  if (hasPeriods(block)) return block.periods.length;
  return clampCount(block?.periodCount) || 1;
}

function placeholderPeriod(cadence, n, keys) {
  let key = `${KEY_PREFIX[cadence] || "p"}${n}`;
  let bump = 1;
  while (keys.has(key)) {
    key = `${KEY_PREFIX[cadence] || "p"}${n}-${bump}`;
    bump += 1;
  }
  keys.add(key);
  return { key, label: periodLabelFor(cadence, n) };
}

/**
 * Give a FLAT block one placeholder period per window so content can be
 * mapped onto it. No-op when periods already exist. The count is the resolved
 * cycle length, so the shape the user sees is the shape that gets saved.
 */
export function materialisePeriods(block, count) {
  if (hasPeriods(block)) return block;
  const n = clampCount(count);
  if (!n) return block;
  const keys = new Set();
  const periods = [];
  for (let i = 0; i < n; i += 1) periods.push(placeholderPeriod(block.cadence, i + 1, keys));
  const out = { ...block, periods };
  delete out.periodCount;
  return out;
}

// ─── period content ───────────────────────────────────────────────────

const DETAIL_CAP = Object.freeze({
  activities: DETAIL_MAX_ACTIVITIES,
  deliverables: DETAIL_MAX_DELIVERABLES,
});

/** How many more `kind` items window `periodIdx` can hold. */
export function detailCapacity(block, periodIdx, kind) {
  const cap = DETAIL_CAP[kind];
  if (!cap) return 0;
  const have = block?.periods?.[periodIdx]?.detail?.[kind]?.length || 0;
  return Math.max(0, cap - have);
}

function tidyDetail(detail) {
  if (!detail) return null;
  const out = {};
  if (typeof detail.focus === "string" && detail.focus.trim()) out.focus = detail.focus;
  if (Array.isArray(detail.activities) && detail.activities.length) out.activities = detail.activities;
  if (Array.isArray(detail.deliverables) && detail.deliverables.length) out.deliverables = detail.deliverables;
  return Object.keys(out).length ? out : null;
}

function withDetail(period, detail) {
  const tidy = tidyDetail(detail);
  const out = { ...period };
  if (tidy) out.detail = tidy;
  else delete out.detail;
  return out;
}

function replacePeriod(block, idx, period) {
  const periods = block.periods.slice();
  periods[idx] = period;
  return { ...block, periods };
}

/** Fold `from`'s narrative into `into` — used when a window is removed or the cycle shortened. */
export function mergePeriodContent(into, from) {
  const a = into.detail || {};
  const b = from.detail || {};
  const detail = {
    focus: a.focus || b.focus,
    activities: [...(a.activities || []), ...(b.activities || [])].slice(0, DETAIL_MAX_ACTIVITIES),
    deliverables: [...(a.deliverables || []), ...(b.deliverables || [])].slice(0, DETAIL_MAX_DELIVERABLES),
  };
  const merged = withDetail(into, detail);
  const notes = [...(into.notes || []), ...(from.notes || [])].slice(0, NOTES_MAX);
  if (notes.length) merged.notes = notes;
  else delete merged.notes;
  return merged;
}

/**
 * Move one activity / deliverable from window `from` to window `to`. Same
 * window with a position = reorder. Returns the block unchanged when the
 * target is full or anything is out of range — callers check
 * `detailCapacity` first to explain why.
 */
export function moveDetailItem(block, from, to) {
  const kind = from?.kind;
  if (!DETAIL_CAP[kind] || !hasPeriods(block)) return block;
  const src = block.periods[from.index];
  const dst = block.periods[to?.index];
  if (!src || !dst) return block;
  const items = src.detail?.[kind] || [];
  if (from.item < 0 || from.item >= items.length) return block;
  const [moved] = items.slice(from.item, from.item + 1);

  if (from.index === to.index) {
    const next = items.slice();
    next.splice(from.item, 1);
    let at = typeof to.position === "number" ? to.position : next.length;
    at = Math.max(0, Math.min(next.length, at));
    next.splice(at, 0, moved);
    return replacePeriod(block, from.index, withDetail(src, { ...src.detail, [kind]: next }));
  }

  if (detailCapacity(block, to.index, kind) < 1) return block;
  const srcNext = items.slice();
  srcNext.splice(from.item, 1);
  const dstItems = (dst.detail?.[kind] || []).slice();
  let at = typeof to.position === "number" ? to.position : dstItems.length;
  at = Math.max(0, Math.min(dstItems.length, at));
  dstItems.splice(at, 0, moved);
  const periods = block.periods.slice();
  periods[from.index] = withDetail(src, { ...src.detail, [kind]: srcNext });
  periods[to.index] = withDetail(dst, { ...dst.detail, [kind]: dstItems });
  return { ...block, periods };
}

export function addDetailItem(block, periodIdx, kind, value) {
  if (!DETAIL_CAP[kind] || !hasPeriods(block)) return block;
  const period = block.periods[periodIdx];
  if (!period || detailCapacity(block, periodIdx, kind) < 1) return block;
  const text = typeof value === "string" ? value.trim() : value?.label?.trim();
  if (!text) return block;
  const item = kind === "deliverables" ? (typeof value === "string" ? { label: text } : { ...value, label: text }) : text;
  const items = [...(period.detail?.[kind] || []), item];
  return replacePeriod(block, periodIdx, withDetail(period, { ...period.detail, [kind]: items }));
}

export function removeDetailItem(block, periodIdx, kind, itemIdx) {
  if (!DETAIL_CAP[kind] || !hasPeriods(block)) return block;
  const period = block.periods[periodIdx];
  const items = period?.detail?.[kind];
  if (!items || itemIdx < 0 || itemIdx >= items.length) return block;
  const next = items.slice();
  next.splice(itemIdx, 1);
  return replacePeriod(block, periodIdx, withDetail(period, { ...period.detail, [kind]: next }));
}

export function setPeriodLabel(block, periodIdx, label) {
  const period = block?.periods?.[periodIdx];
  if (!period) return block;
  const text = typeof label === "string" ? label.trim().slice(0, 160) : "";
  return replacePeriod(block, periodIdx, {
    ...period,
    label: text || periodLabelFor(block.cadence, periodIdx + 1),
  });
}

export function setPeriodFocus(block, periodIdx, focus) {
  const period = block?.periods?.[periodIdx];
  if (!period) return block;
  return replacePeriod(block, periodIdx, withDetail(period, { ...period.detail, focus: focus || "" }));
}

export function setPeriodDueAt(block, periodIdx, iso) {
  const period = block?.periods?.[periodIdx];
  if (!period) return block;
  const day = toIsoDay(iso);
  const out = { ...period };
  if (day) out.dueAt = day;
  else delete out.dueAt;
  return replacePeriod(block, periodIdx, out);
}

// ─── period structure ─────────────────────────────────────────────────

/** Swap two windows' content (labels, detail, fields, nesting travel together). */
export function swapPeriods(block, i, j) {
  if (!hasPeriods(block)) return block;
  const n = block.periods.length;
  if (i < 0 || j < 0 || i >= n || j >= n || i === j) return block;
  const periods = block.periods.slice();
  [periods[i], periods[j]] = [periods[j], periods[i]];
  return { ...block, periods };
}

/** Insert an empty window after `i` (or at the end when `i` is the last). */
export function insertPeriodAfter(block, i, bounds) {
  const count = currentCount(block);
  if (count >= COMPOSED_MAX_PERIODS) return block;
  const base = hasPeriods(block) ? block : materialisePeriods(block, bounds?.periodCount ?? count);
  const keys = new Set(base.periods.map((p) => p.key));
  const periods = base.periods.slice();
  const at = Math.max(0, Math.min(periods.length, i + 1));
  periods.splice(at, 0, placeholderPeriod(base.cadence, at + 1, keys));
  return setPeriodCount({ ...base, periods }, periods.length, bounds);
}

/**
 * Remove window `i`, folding its content into its predecessor (or successor
 * for the first window) so nothing authored disappears. The last remaining
 * window can't be removed — a plan has at least one.
 */
export function removePeriod(block, i, bounds) {
  if (!hasPeriods(block) || block.periods.length <= 1) return block;
  const periods = block.periods.slice();
  if (i < 0 || i >= periods.length) return block;
  const [gone] = periods.splice(i, 1);
  const into = i > 0 ? i - 1 : 0;
  periods[into] = mergePeriodContent(periods[into], gone);
  return setPeriodCount({ ...block, periods }, periods.length, bounds);
}

// ─── nesting ──────────────────────────────────────────────────────────

/** Give window `i` a nested cadence (or clear it with null). Materialises a flat block first. */
export function setNestedCadence(block, i, cadence, bounds) {
  const base = hasPeriods(block) ? block : materialisePeriods(block, bounds?.periodCount ?? currentCount(block));
  const period = base.periods?.[i];
  if (!period) return block;
  const out = { ...period };
  if (cadence && isPlanCadence(cadence)) {
    out.nested = { ...(period.nested || {}), cadence };
  } else {
    delete out.nested;
  }
  return replacePeriod(base, i, out);
}

export function setNestedBlock(block, i, nested) {
  const period = block?.periods?.[i];
  if (!period) return block;
  const out = { ...period };
  if (nested && Object.keys(nested).length) out.nested = nested;
  else delete out.nested;
  return replacePeriod(block, i, out);
}

export function setManagementBlock(block, management) {
  const out = { ...block };
  if (management && Object.keys(management).length) out.management = management;
  else delete out.management;
  return out;
}

// ─── diffing ──────────────────────────────────────────────────────────

/**
 * Did the edit change how windows are KEYED — cadence, start, or length? A
 * yes means entries logged under the old keys may no longer line up, and a
 * manager-approved plan is no longer the plan they approved.
 */
export function isStructuralChange(before, after) {
  if (!before || !after) return before !== after;
  return (
    before.cadence !== after.cadence ||
    (before.cycleStart || null) !== (after.cycleStart || null) ||
    (before.cycleEnd || null) !== (after.cycleEnd || null) ||
    currentCount(before) !== currentCount(after)
  );
}

/** Every activity + deliverable in a block, for a "how much is mapped" count. */
export function countDetailItems(block) {
  let n = 0;
  for (const p of block?.periods || []) {
    n += p.detail?.activities?.length || 0;
    n += p.detail?.deliverables?.length || 0;
  }
  return n;
}
