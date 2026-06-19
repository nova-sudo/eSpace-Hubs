/**
 * Cycle-anchored cadence windows — the model behind the cadence stepper.
 *
 * Unlike `fillStats` (which buckets "windows since the first entry"), this
 * enumerates the FIXED set of windows that tile a review cycle: a quarterly
 * goal has exactly 4 windows (Q1–Q4), a monthly goal has 12, etc. Each window
 * is tagged filled / owed / current / future from the entry timestamps and
 * `now`. Non-bucketing cadences (milestone / continuous / per-incident) and
 * cadence-less goals collapse to a single completion "pip".
 *
 * Pure — no React, no IO. The component passes `entries`, the cadence, and
 * `now` (Date.now() from the client). v1 anchors the cycle to the calendar
 * year of `now`; a goal's real `cycleId` bounds can be threaded in later via
 * `cycleStart` / `cycleEnd`.
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

/** Enumerate [start,end) windows tiling [cycleStart, cycleEnd) for a cadence. */
function enumerateWindows(cadence, year, cycleStart, cycleEnd) {
  const out = [];
  if (cadence === "quarterly") {
    for (let q = 0; q < 4; q += 1) {
      out.push({
        start: Date.UTC(year, q * 3, 1),
        end: Date.UTC(year, q * 3 + 3, 1),
        key: `${year}-Q${q + 1}`,
        label: `Q${q + 1}`,
      });
    }
    return out;
  }
  if (cadence === "monthly") {
    for (let m = 0; m < 12; m += 1) {
      out.push({
        start: Date.UTC(year, m, 1),
        end: Date.UTC(year, m + 1, 1),
        key: `${year}-${String(m + 1).padStart(2, "0")}`,
        label: MONTHS[m],
      });
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
    let state;
    if (filled) state = "filled";
    else if (locks?.has(w.key)) state = "settled";
    else if (w.end <= now) state = "owed";
    else if (w.start <= now && now < w.end) state = "current";
    else state = "future";
    if (state === "current") currentIndex = i;
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
