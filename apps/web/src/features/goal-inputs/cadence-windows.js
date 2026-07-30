/**
 * Cycle-anchored cadence windows — the model behind the cadence stepper AND
 * the Goal Intelligence Hub's fill status (deriveGoalHealth in
 * features/intelligence/status.js), so both surfaces agree on which periods
 * are filled/owed instead of computing it two different ways.
 *
 * This enumerates the FIXED set of windows that tile a review cycle: a
 * quarterly goal has exactly 4 windows (Q1–Q4), a monthly goal has 12, etc.
 * Each window is tagged filled / owed / current / future from the entry
 * timestamps and `now`. Non-bucketing cadences (milestone / continuous /
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

/** Enumerate [start,end) windows tiling [cycleStart, cycleEnd) for a cadence. */
function enumerateWindows(cadence, year, cycleStart, cycleEnd) {
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
  // weekly / biweekly / daily — fixed-stride buckets from cycle start. Simple
  // and stable; exact ISO-week alignment isn't needed for a compliance view.
  const DAY = 86_400_000;
  const stride =
    cadence === "daily" ? DAY : cadence === "biweekly" ? 14 * DAY : 7 * DAY;
  const prefix = cadence === "daily" ? "D" : cadence === "biweekly" ? "B" : "W";
  let i = 0;
  for (let s = cycleStart; s < cycleEnd; s += stride) {
    out.push({
      start: s,
      end: Math.min(s + stride, cycleEnd),
      key: `${year}-${prefix}${i + 1}`,
      label: `${prefix}${i + 1}`,
    });
    i += 1;
  }
  return out;
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
 * keys (pure calendar labels, unaffected by where the stride starts), a
 * weekly key is `${year}-W${i+1}` where `i` is the STRIDE INDEX from
 * `cycleStart`. Defaulting to Jan 1 for a plan that actually starts in
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
  const cs = spec?.composed?.cycleStart;
  const ce = spec?.composed?.cycleEnd;
  if (typeof cs !== "string" || typeof ce !== "string") return {};
  const start = Date.parse(cs);
  const endDay = Date.parse(ce);
  if (Number.isNaN(start) || Number.isNaN(endDay) || endDay <= start) return {};
  const DAY = 86_400_000;
  return { cycleStart: start, cycleEnd: endDay + DAY };
}

export function buildCycleWindows({
  entries,
  cadence,
  now,
  cycleStart,
  cycleEnd,
  lockedKeys,
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
  const locks = lockedKeys instanceof Set ? lockedKeys : null;

  const raw = enumerateWindows(cadence, year, start, end);
  let currentIndex = -1;
  let filledCount = 0;

  const windows = raw.map((w, i) => {
    const filled = entryFilled(list, w.start, w.end);
    if (filled) filledCount += 1;
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
    else if (locks?.has(w.key)) state = "settled";
    else if (w.end <= now) state = "owed";
    else if (isCurrentPeriod) state = "current";
    else state = "future";
    if (isCurrentPeriod) currentIndex = i;
    return { ...w, filled, state };
  });

  return {
    mode: windows.length <= STEPPER_MAX ? "stepper" : "heatmap",
    cadence,
    windows,
    total: windows.length,
    filledCount,
    currentIndex,
  };
}
