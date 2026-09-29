/**
 * Cycle-anchored cadence windows (moved here from
 * apps/web/src/features/goal-inputs/cadence-windows.js, which re-exports it,
 * so the API can compute the same period grid for shared-goal analytics) — the model behind the cadence stepper AND
 * the Goal Intelligence Hub's fill status (deriveGoalHealth in
 * features/intelligence/status.js), so both surfaces agree on which periods
 * are filled/owed instead of computing it two different ways.
 *
 * This enumerates the FIXED set of windows that tile a review cycle: a
 * quarterly goal has exactly 4 windows (Q1–Q4), a monthly goal has 12, etc.
 * Weekly (and biweekly) windows are Sunday-anchored work weeks, numbered and
 * labelled exactly like the snapshot store's weeks (see weeks.js). Each
 * window is tagged filled / settled / before / owed / current / future from
 * the entry timestamps, settle locks, the tracker's start and `now`. Non-bucketing cadences (milestone / continuous /
 * per-incident) and cadence-less goals collapse to a single completion "pip".
 *
 * Pure — no React, no IO. The component passes `entries`, the cadence, and
 * `now` (Date.now() from the client). `cycleStart` / `cycleEnd` default to the
 * calendar year of `now`; pass them explicitly for a goal whose cycle doesn't
 * run Jan–Dec (a 6-month IDP starting in August, say). Monthly and quarterly
 * windows stay snapped to calendar boundaries either way, so their keys remain
 * comparable across goals and with `currentPeriodKey`.
 *
 * Render mode:
 *   - "pip"      non-bucketing / no cadence → complete ↔ incomplete
 *   - "stepper"  ≤ STEPPER_MAX windows (quarterly = 4, monthly = 12)
 *   - "heatmap"  more (weekly ≈ 52, daily ≈ 365)
 */

import {
  DAY_MS,
  WEEK_MS,
  legacyPaddedWeekKeyUtc,
  sundayOnOrBeforeUtc,
  weekLabelUtc,
} from "./weeks.js";

const STEPPER_MAX = 13;

const NON_BUCKETING = new Set(["milestone", "continuous", "per-incident"]);

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function entryFilled(entries, start, end) {
  for (const e of entries) {
    const ts = typeof e?.ts === "number" ? e.ts : null;
    if (ts != null && ts >= start && ts < end) return true;
  }
  return false;
}

/** Runaway guard for the calendar-window walk — 64 months / 64 quarters. */
const MAX_CALENDAR_WINDOWS = 64;

/** Runaway guard for the week walk — five years of weeks. */
const MAX_STRIDE_WINDOWS = 262;

/** Enumerate [start,end) windows tiling [cycleStart, cycleEnd) for a cadence. */
export function enumerateWindows(cadence, year, cycleStart, cycleEnd) {
  const out = [];
  // Monthly + quarterly walk the CALENDAR from the period containing
  // `cycleStart` until `cycleEnd`, rather than always tiling Jan–Dec of one
  // year. Two things depend on this:
  //   1. A cycle that doesn't start in January (a 6-month IDP running Aug–Jan)
  //      is representable at all — the old version silently returned the wrong
  //      12 windows for it.
  //   2. A cycle that crosses a year boundary keeps going instead of stopping
  //      at Dec 31.
  // Windows stay snapped to calendar month/quarter boundaries, so `key` keeps
  // its existing `YYYY-MM` / `YYYY-Q#` shape and stays comparable with
  // `currentPeriodKey` and with every periodKey already persisted in
  // goal-inputs. With the default full-calendar-year bounds the output is
  // identical to before, element for element.
  if (cadence === "quarterly" || cadence === "monthly") {
    const monthly = cadence === "monthly";
    const step = monthly ? 1 : 3;
    const from = new Date(cycleStart);
    let y = from.getUTCFullYear();
    // Snap back to the first month of the containing month/quarter, so a cycle
    // starting mid-period still yields whole, calendar-aligned windows.
    let m = monthly
      ? from.getUTCMonth()
      : Math.floor(from.getUTCMonth() / 3) * 3;
    // Disambiguate labels only when the cycle spans more than one calendar
    // year — otherwise a 13-month cycle would render "Jan" twice with no way
    // to tell them apart. Single-year cycles keep the bare "Jan" / "Q1".
    const spansYears = new Date(cycleEnd - 1).getUTCFullYear() !== y;
    for (let i = 0; i < MAX_CALENDAR_WINDOWS; i += 1) {
      const start = Date.UTC(y, m, 1);
      if (start >= cycleEnd) break;
      const suffix = spansYears ? ` ${String(y).slice(2)}` : "";
      out.push(
        monthly
          ? {
              start,
              end: Date.UTC(y, m + 1, 1),
              key: `${y}-${String(m + 1).padStart(2, "0")}`,
              label: `${MONTHS[m]}${suffix}`,
            }
          : {
              start,
              end: Date.UTC(y, m + 3, 1),
              key: `${y}-Q${Math.floor(m / 3) + 1}`,
              label: `Q${Math.floor(m / 3) + 1}${suffix}`,
            },
      );
      m += step;
      if (m > 11) {
        y += Math.floor(m / 12);
        m %= 12;
      }
    }
    return out;
  }
  // Key year comes from the CYCLE START, never the `year` parameter (which
  // callers derive from `now`): a Sept-2026→Feb-2027 cycle's 14th week must
  // key "2026-W14" in December AND in January. Stamping now's year re-keyed
  // every stride window at the calendar rollover, orphaning the entries and
  // locks written under the old keys (audit #237). Month/quarter keys above
  // are already cycle-derived and never had this bug.
  const keyYear = new Date(cycleStart).getUTCFullYear();

  if (cadence === "weekly" || cadence === "biweekly") {
    // Sunday-anchored WORK WEEKS (see weeks.js). Window i spans the i-th
    // Sunday-week (or pair of weeks) counted from the week containing
    // `cycleStart`, CLIPPED to the cycle: 2026 starts on a Thursday, so a
    // calendar-year cycle's first weekly window is Thu 1 – Sat 3 Jan, and
    // every later one is a whole Sun→Sat week.
    //
    // Keys stay `${cycleStartYear}-W${i+1}` / `-B${i+1}` — the INDEX from
    // the cycle start, exactly the shape they had when windows were fixed
    // 7-day strides from `cycleStart`. The old stride window i started on
    // cycleStart + 7i days, which always falls inside the new Sunday-week i,
    // so every key already persisted (settle locks, composed entries'
    // `periodKey`, evidence files, per-window tier verdicts) maps onto the
    // new window containing its old START without any rewrite. For a
    // calendar-year cycle the index even equals the week number: key
    // "2026-W39" is the window labelled W39 (Sep 20–26).
    //
    // Labels are the canonical week number of the window's first day —
    // identical to the snapshot store's weekLabel/weekKey — so "W39" names
    // the same days everywhere. A week that straddles New Year inside a
    // cross-year cycle keeps one window, labelled by its Sunday's year (the
    // snapshot capture files it the same way, by its Wednesday).
    const stride = cadence === "biweekly" ? 2 * WEEK_MS : WEEK_MS;
    const prefix = cadence === "biweekly" ? "B" : "W";
    const anchor = sundayOnOrBeforeUtc(cycleStart);
    const spansYears = new Date(cycleEnd - 1).getUTCFullYear() !== keyYear;
    for (let i = 0; i < MAX_STRIDE_WINDOWS; i += 1) {
      const start = Math.max(cycleStart, anchor + i * stride);
      if (start >= cycleEnd) break;
      const end = Math.min(anchor + (i + 1) * stride, cycleEnd);
      const suffix = spansYears ? ` ${String(new Date(start).getUTCFullYear()).slice(2)}` : "";
      const firstWeek = weekLabelUtc(start);
      let label = firstWeek;
      if (cadence === "biweekly") {
        const lastWeek = weekLabelUtc(end - 1);
        if (lastWeek !== firstWeek) label = `${firstWeek}–${lastWeek.slice(1)}`;
      }
      out.push({
        start,
        end,
        key: `${keyYear}-${prefix}${i + 1}`,
        label: `${label}${suffix}`,
      });
    }
    return out;
  }

  // daily — fixed one-day buckets from cycle start (a cycle start is a UTC
  // midnight, so these are plain calendar days).
  let i = 0;
  for (let s = cycleStart; s < cycleEnd && i < MAX_STRIDE_WINDOWS * 7; s += DAY_MS) {
    out.push({
      start: s,
      end: Math.min(s + DAY_MS, cycleEnd),
      key: `${keyYear}-D${i + 1}`,
      label: `D${i + 1}`,
    });
    i += 1;
  }
  return out;
}

/**
 * Other strings that name window `w` in persisted data (settle locks), for
 * windows whose canonical key changed shape over time. Today that's the
 * goal-locks `currentWindowKey` scheme ("Lock this week" on the Intelligence
 * hub), which wrote:
 *   weekly / biweekly → "YYYY-Wnn" (zero-padded Sunday-week number)
 *   daily             → "YYYY-MM-DD"
 * An alias is only honoured when it can't be mistaken for ANOTHER window's
 * canonical key in the same cycle (`cycleKeys`) — "2026-W39" is both a
 * padded Sunday-week key and the canonical key of this cycle's 39th window;
 * for a calendar-year cycle those are the same window, for a cycle starting
 * mid-year they are not, and the canonical meaning wins.
 */
export function windowKeyAliases(cadence, w, cycleKeys) {
  const out = [];
  if (cadence === "weekly" || cadence === "biweekly") {
    for (let s = sundayOnOrBeforeUtc(w.start); s < w.end; s += WEEK_MS) {
      out.push(legacyPaddedWeekKeyUtc(Math.max(s, w.start)));
    }
  } else if (cadence === "daily") {
    out.push(new Date(w.start).toISOString().slice(0, 10));
  }
  return out.filter((k) => k !== w.key && !(cycleKeys && cycleKeys.has(k)));
}

/**
 * The window KEY for the period containing `now` (e.g. "2026-Q2") — or null
 * for non-bucketing / cadence-less goals. Shares the exact key scheme of
 * `buildCycleWindows`, so a COMPOSED widget's "current period" record lines up
 * with the stepper cell the user clicks and with the grader's reading.
 *
 * `cycleStart`/`cycleEnd` (epoch ms, from `composedCycleBounds`) default to
 * the calendar year of `now`, same as `buildCycleWindows` — but passing them
 * matters here specifically for weekly/biweekly/daily: unlike month/quarter
 * keys (pure calendar labels, unaffected by where the cycle starts), a
 * weekly key is `${year}-W${i+1}` where `i` is the window INDEX counted from
 * the Sunday-week containing `cycleStart`. Defaulting to Jan 1 for a plan that actually starts in
 * September would number its first week "W37" instead of "W1" — the wrong
 * key for that plan's own window enumeration, so nothing written under it
 * would ever match up with the widget's cycle-anchored windows.
 */
export function currentPeriodKey(cadence, now, cycleStart, cycleEnd) {
  if (!cadence || NON_BUCKETING.has(cadence)) return null;
  const year = new Date(now).getUTCFullYear();
  const start = cycleStart ?? Date.UTC(year, 0, 1);
  const end = cycleEnd ?? Date.UTC(year + 1, 0, 1);
  const w = enumerateWindows(cadence, year, start, end).find(
    (x) => now >= x.start && now < x.end,
  );
  return w ? w.key : null;
}

/**
 * Cadence CONSISTENCY over the periods that are DONE. Of the windows that have
 * elapsed — filled + settled + owed, but NOT the in-progress `current` one and
 * NOT `future` — what fraction did the user actually satisfy (log or explicitly
 * settle as "nothing to report")? This is the "did you keep up with the
 * cadence" signal the tier grader caps on, so a goal filled in one strong month
 * can't read "over achieved" for the whole year, while a goal whose only
 * "missing" periods are still upcoming isn't penalised for them.
 *
 * Pass a cycle from `buildCycleWindows` (ideally WITH `lockedKeys`, so settled
 * periods count as satisfied). Returns null for pip mode / no windows / no
 * elapsed periods yet — too early to judge, grade leniently until then.
 *
 * @returns {{ satisfied:number, missed:number, due:number, ratio:number }|null}
 */
export function cadenceConsistency(cycle) {
  if (!cycle || cycle.mode === "pip" || !Array.isArray(cycle.windows)) return null;
  let satisfied = 0;
  let missed = 0;
  for (const w of cycle.windows) {
    if (w.state === "filled" || w.state === "settled") satisfied += 1;
    else if (w.state === "owed") missed += 1;
    // "current" (in progress) and "future" are not yet due-and-done → excluded
  }
  const due = satisfied + missed;
  if (due === 0) return null;
  return { satisfied, missed, due, ratio: satisfied / due };
}

/**
 * `{cycleStart, cycleEnd}` (epoch ms, exclusive end) from `spec.composed`'s
 * ISO date pair — or `{}` when either is absent/malformed, so callers can
 * always spread this into `buildCycleWindows({ ...composedCycleBounds(spec) })`
 * and get today's calendar-year default for any spec that predates this
 * field. `cycleEnd` is the day AFTER the stored date: the stored value is the
 * plan's last inclusive day, but window enumeration wants an exclusive
 * upper bound.
 */
export function composedCycleBounds(spec) {
  const bounds = composedCycleOnly(spec);
  // Decision 2 — a tracker counts from the day it was created. Folded in
  // here because every consumer already spreads this into buildCycleWindows,
  // so the Goals page, the Intelligence hub, the grader and the backfill
  // banner all agree on which windows are "before" without each learning
  // about the new field.
  const trackingStart = specTrackingStart(spec, bounds.cycleStart);
  return trackingStart != null ? { ...bounds, trackingStart } : bounds;
}

function toMsLoose(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * When this tracker starts COUNTING (epoch ms), or null when it counts from
 * its cycle start as before: the later of the spec's creation time
 * (`spec.createdAt`, stamped from the goal_specs row by the client store /
 * API) and the owner's `hireDate` (`spec.hireDate` or `opts.hireDate`).
 * Windows that END on or before this are optional backfill ("before"),
 * never owed — a tracker created in late September doesn't owe January.
 *
 * Returns null when it would not move anything (no stamp, or a stamp at or
 * before the cycle start), so callers can keep treating "no tracking start"
 * as today's behaviour.
 */
export function specTrackingStart(spec, cycleStart, opts = {}) {
  const created = toMsLoose(spec?.createdAt);
  const hire = toMsLoose(opts.hireDate ?? spec?.hireDate);
  let t = null;
  for (const v of [created, hire]) {
    if (v != null && (t == null || v > t)) t = v;
  }
  if (t == null) return null;
  if (cycleStart != null && t <= cycleStart) return null;
  return t;
}

function composedCycleOnly(spec) {
  const composed = spec?.composed;
  const cs = composed?.cycleStart;
  if (typeof cs !== "string") return {};
  const start = Date.parse(cs);
  if (Number.isNaN(start)) return {};
  const DAY = 86_400_000;

  // The plan's stated LENGTH — structurally (authored periods) or as
  // `periodCount` ("a 13-week programme" on a flat tracker).
  const count = composed.periods?.length || composed.periodCount || 0;
  const derivedEnd =
    count > 0 ? deriveCycleEndIso(cs.trim().slice(0, 10), composed.cadence, count) : null;
  const derivedEndDay = derivedEnd ? Date.parse(derivedEnd) : NaN;

  const ce = composed?.cycleEnd;
  if (typeof ce === "string") {
    const endDay = Date.parse(ce);
    if (!Number.isNaN(endDay) && endDay > start) {
      // A weekly/biweekly plan whose stored end was sized with the OLD
      // fixed-stride weeks (cycleStart + 7N days) runs a few days past the
      // Sunday-anchored Nth week, which would grow a stub window N+1 with no
      // authored content. When the plan states its length and the stored
      // end overshoots the derived one by less than one stride, the stored
      // end is that legacy artefact — read the derived end instead. (The
      // composed widget's self-heal rewrites it on the next visit.)
      const strideDays = composed.cadence === "biweekly" ? 14 : composed.cadence === "weekly" ? 7 : 0;
      if (
        strideDays > 0 &&
        !Number.isNaN(derivedEndDay) &&
        endDay > derivedEndDay &&
        endDay - derivedEndDay < strideDays * DAY &&
        derivedEndDay > start
      ) {
        return { cycleStart: start, cycleEnd: derivedEndDay + DAY };
      }
      return { cycleStart: start, cycleEnd: endDay + DAY };
    }
  }

  // No stored end, but the plan states its LENGTH. Derive the end rather
  // than falling through to the caller's calendar-year default, which is the
  // 53-windows-for-a-13-week-plan bug: every window past the plan's real
  // length renders as a cell the user is told they owe, and
  // cadence-consistency grades against periods that were never part of the
  // plan.
  //
  // This makes the fix hold for a spec the composed widget's self-heal
  // hasn't rewritten yet (it only fires on a mounted widget, and only once
  // per session), so the stepper, the widget, the Intelligence Hub and the
  // grader all agree on the same cycle immediately.
  if (!Number.isNaN(derivedEndDay) && derivedEndDay > start) {
    return { cycleStart: start, cycleEnd: derivedEndDay + DAY };
  }
  return {};
}

/** Generous per-window upper bound (days) — just needs to exceed the real window length. */
const CADENCE_MAX_WINDOW_DAYS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 31,
  quarterly: 93,
};

/**
 * ISO date (inclusive last day) for the end of the Nth cadence window
 * starting at `cycleStartIso` — i.e. the cycle bound that makes
 * buildCycleWindows produce EXACTLY `periodCount` windows, matching however
 * many periods were actually authored. Returns null for an unparseable
 * start, an unrecognised cadence, or a non-positive count.
 *
 * This is deliberately what anchors a plan's END, not the underlying goal's
 * own `dueDate`: a document can describe a 13-week Q3 sub-plan inside a goal
 * whose own due date is a year out, and borrowing the goal's date stretched
 * the cycle to however many weeks separated them (53, in the bug this fixed)
 * — window 14 onward existed but had no authored content, an unlabeled tail
 * the widget had no business rendering. Deriving from `periodCount` instead
 * makes that tail structurally impossible: the cycle can only ever be as
 * long as there are periods to fill it.
 */
/**
 * Normalize a date-ish string to the strict "YYYY-MM-DD" the spec
 * validator's cycle-bounds check accepts — a full ISO datetime is
 * truncated to its day. Anything else (empty, non-ISO, garbage) → null.
 * The composed widget's cycle self-heal MUST run its candidates through
 * this: feeding the validator a shape it drops means the saved spec
 * comes back without the bounds, and an effect keyed on them re-saves
 * forever.
 */
export function toIsoDay(value) {
  if (typeof value !== "string") return null;
  const day = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return day;
}

export function deriveCycleEndIso(cycleStartIso, cadence, periodCount) {
  const startMs = typeof cycleStartIso === "string" ? Date.parse(cycleStartIso) : NaN;
  const perWindowDays = CADENCE_MAX_WINDOW_DAYS[cadence];
  if (
    Number.isNaN(startMs) ||
    !perWindowDays ||
    !Number.isInteger(periodCount) ||
    periodCount <= 0
  ) {
    return null;
  }
  const DAY = 86_400_000;
  // +1 window of margin: enumerateWindows snaps a mid-period start back to
  // its calendar boundary (see the quarterly/monthly branch), which can push
  // the Nth window's end slightly past a bound sized on raw days alone.
  const generousEnd = startMs + (periodCount + 1) * perWindowDays * DAY;
  const cycle = buildCycleWindows({
    entries: [],
    cadence,
    now: startMs,
    cycleStart: startMs,
    cycleEnd: generousEnd,
  });
  const w = cycle.windows?.[periodCount - 1];
  if (!w) return null;
  // `w.end` is exclusive; the stored field is the inclusive last day.
  return new Date(w.end - DAY).toISOString().slice(0, 10);
}

/**
 * The cadence window grid for one tracker, each window tagged with a state:
 *
 *   filled   has an entry (always wins — a backfilled "before" window counts)
 *   settled  the user marked it "nothing to report" (a goal-lock)
 *   before   ended before the tracker started counting (`trackingStart`) —
 *            optional backfill, never owed, excluded from every denominator
 *   owed     ended, nothing logged
 *   current  contains `now`
 *   future   hasn't started
 *
 * Counts: `total` is the number of windows that COUNT (every window except
 * the unfilled "before" ones) — the denominator for progress, "logged on
 * time" and the "x of y" labels. `windowCount` is every window rendered.
 * `expectedPct` (0–100) is how far through the counted span `now` is — the
 * pace tick a tracker should be compared against.
 */
export function buildCycleWindows({
  entries,
  cadence,
  now,
  cycleStart,
  cycleEnd,
  lockedKeys,
  trackingStart,
}) {
  const list = Array.isArray(entries) ? entries : [];
  const hasData = list.length > 0;

  // No cadence, or a non-bucketing one → a single completion pip.
  if (!cadence || NON_BUCKETING.has(cadence)) {
    return { mode: "pip", cadence: cadence || null, hasData, complete: hasData };
  }

  const year = new Date(now).getUTCFullYear();
  const start = cycleStart ?? Date.UTC(year, 0, 1);
  const end = cycleEnd ?? Date.UTC(year + 1, 0, 1);
  const locks = lockedKeys instanceof Set && lockedKeys.size > 0 ? lockedKeys : null;
  const tracking =
    typeof trackingStart === "number" && Number.isFinite(trackingStart) && trackingStart > start
      ? trackingStart
      : null;

  const raw = enumerateWindows(cadence, year, start, end);
  const cycleKeys = locks ? new Set(raw.map((w) => w.key)) : null;
  const isSettled = (w) => {
    if (!locks) return false;
    if (locks.has(w.key)) return true;
    for (const alias of windowKeyAliases(cadence, w, cycleKeys)) {
      if (locks.has(alias)) return true;
    }
    return false;
  };

  let currentIndex = -1;
  let filledCount = 0;
  // filled + settled ("nothing to report"). `filledCount` stays "has an
  // entry" because the grader and compliance read it that way; progress and
  // the "logged on time" headline read `doneCount`, where a settled window
  // counts as kept up.
  let doneCount = 0;
  let beforeCount = 0;

  const windows = raw.map((w, i) => {
    const filled = entryFilled(list, w.start, w.end);
    const settled = !filled && isSettled(w);
    if (filled) filledCount += 1;
    if (filled || settled) doneCount += 1;
    // "Is this chronologically the window containing `now`" is a POSITIONAL
    // fact, independent of whether it's been filled — compute it on its own
    // so currentIndex is never lost. (Bug fixed here: state's priority order
    // gives "filled" precedence over "current" for display purposes, which
    // used to ALSO suppress currentIndex whenever the current window already
    // had an entry — the single most common case — silently breaking every
    // consumer that located "today's window" via currentIndex.)
    const isCurrentPeriod = w.start <= now && now < w.end;
    let state;
    if (filled) state = "filled";
    else if (settled) state = "settled";
    else if (tracking != null && w.end <= tracking) state = "before";
    else if (w.end <= now) state = "owed";
    else if (isCurrentPeriod) state = "current";
    else state = "future";
    if (state === "before") beforeCount += 1;
    if (isCurrentPeriod) currentIndex = i;
    return { ...w, filled, state };
  });

  // Pace: the share of the COUNTED span (from the first window that isn't
  // pre-tracking to the cycle's end) that has elapsed.
  let expectedPct = null;
  if (windows.length > 0) {
    const firstCounted = windows.find((w) => !(tracking != null && w.end <= tracking));
    // …and never before the tracker itself started: a quarterly tracker
    // approved on 28 Sep isn't "expected" to be half-way through Q3.
    const spanStart = firstCounted
      ? Math.max(firstCounted.start, tracking ?? firstCounted.start)
      : windows[windows.length - 1].end;
    const spanEnd = windows[windows.length - 1].end;
    const span = spanEnd - spanStart;
    expectedPct = span > 0 ? Math.max(0, Math.min(100, ((now - spanStart) / span) * 100)) : 100;
  }

  return {
    mode: windows.length <= STEPPER_MAX ? "stepper" : "heatmap",
    cadence,
    windows,
    total: windows.length - beforeCount,
    windowCount: windows.length,
    beforeCount,
    filledCount,
    doneCount,
    currentIndex,
    trackingStart: tracking,
    expectedPct,
  };
}
