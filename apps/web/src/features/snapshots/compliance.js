/**
 * Compliance reading from the immutable snapshot stream.
 *
 * Given an array of weekly snapshots and a goal id, walks the readings
 * for that goal, groups by `cadenceWindow`, and computes:
 *
 *   - met windows count
 *   - total tracked windows count
 *   - compliance percentage
 *   - latest cadence-window's status (in-progress vs closed)
 *
 * This is the goal's "performance over time" — the metric that lands in
 * evidence exports, the AI analyst card's compliance %, and the goals
 * tab's per-card readings when a date-range chip is active.
 *
 * Why "latest reading per cadence-window" wins
 * ─────────────────────────────────────────────
 * For weekly goals each cadence-window IS one snapshot — trivial.
 * For monthly goals 4-5 snapshots map to one cadence-window. The
 * snapshot taken at end-of-month carries the final cumulative + windowMet
 * values for that month. Earlier-week snapshots show in-progress state,
 * which we don't want to count as the window's "final answer".
 *
 * So: for each cadence-window the goal saw, we take the SNAPSHOT WITH
 * THE NEWEST `capturedAt` falling inside that window. That's the
 * window's authoritative reading.
 *
 * In-progress windows
 * ───────────────────
 * The most recent cadence-window for ongoing goals (current month for a
 * monthly goal, current quarter for a quarterly one) hasn't closed yet.
 * Counting it as either "met" or "not met" punishes/rewards prematurely.
 *
 * Solution: detect "in-progress" by comparing the cadence-window of the
 * latest snapshot against the cadence-window for *now*. If they match,
 * that window is current; we don't count it toward compliance, but we
 * DO surface its `cumulative` + `onPace` so the card can render
 * "tracking 4/8 this quarter — on pace".
 */

import { weekNumber, weekRangeFromLabel } from "@/lib/date";

/**
 * @param {Array<Snapshot>} snapshots — newest-first array from readSnapshots()
 * @param {string} goalId
 * @returns {{
 *   metWindows:     number,
 *   totalWindows:   number,   // closed windows WITH a verdict + missed ones
 *   missedWindows:  number,   // expected windows with NO snapshot at all
 *   pct:            number | null,    // 0..100, null when no closed windows yet
 *   cadence:        string | null,
 *   inProgress: { cadenceWindow, cumulative, target, windowMet, onPace } | null,
 *   windows:        Array<{ cadenceWindow, reading, closed: boolean }>,
 * }}
 *
 * Missed windows — the denominator must be honest
 * ───────────────────────────────────────────────
 * Snapshots only exist when the user opened the dashboard that week, so
 * a window with NO snapshot used to simply not exist: open the app in
 * Q1 and Q4 only and a goal abandoned for six months read
 * "100% · 2 of 2 quarters on target" in the review export. We now
 * enumerate every expected window at the goal's cadence between the
 * EARLIEST window that has a reading and the current (in-progress) one;
 * absent windows count as missed in `totalWindows`/`missedWindows`.
 * Anchoring on the earliest OBSERVED window keeps late adopters fair —
 * months before the user started tracking aren't held against them.
 * (Missed windows are counted, not pushed into `windows`, so display
 * consumers keep their reading-bearing rows.)
 */
export function goalCompliance(snapshots, goalId) {
  if (!Array.isArray(snapshots) || snapshots.length === 0 || !goalId) {
    return empty();
  }

  // Group readings by their cadence-window. For each window we keep the
  // reading from the SNAPSHOT WITH THE LATEST capturedAt that falls in
  // that window — that's the window's final/most-recent state.
  const byWindow = new Map(); // cadenceWindow -> { capturedAt, reading }
  let cadence = null;
  for (const snap of snapshots) {
    const reading = snap?.goalReadings?.[goalId];
    if (!reading) continue;
    const win = reading.cadenceWindow;
    if (!win) continue;
    cadence = cadence || reading.cadence;
    const capturedAt = snap.capturedAt
      ? new Date(snap.capturedAt).getTime()
      : 0;
    const existing = byWindow.get(win);
    if (!existing || existing.capturedAt < capturedAt) {
      byWindow.set(win, { capturedAt, reading });
    }
  }

  if (byWindow.size === 0 || !cadence) return empty();

  // Determine which window represents "right now" for this cadence —
  // any reading whose cadenceWindow matches the current calendar
  // position is the open / in-progress one and gets excluded from
  // compliance counting.
  const currentWindowLabel = currentCadenceWindow(cadence);

  let metWindows = 0;
  let totalWindows = 0;
  let inProgress = null;
  const windows = [];

  for (const [win, { reading }] of byWindow.entries()) {
    const closed = win !== currentWindowLabel;
    windows.push({ cadenceWindow: win, reading, closed });
    if (!closed) {
      inProgress = {
        cadenceWindow: win,
        cumulative: reading.cumulative,
        target: reading.target,
        windowMet: reading.windowMet,
        onPace: reading.onPace,
      };
      continue;
    }
    if (reading.windowMet === true) metWindows += 1;
    if (reading.windowMet != null) totalWindows += 1;
  }

  // Sort windows newest-first for display
  windows.sort((a, b) => b.cadenceWindow.localeCompare(a.cadenceWindow));

  // Honest denominator: expected windows between the earliest observed
  // one and now that have NO snapshot are misses, not non-existence.
  const missedWindows = countMissedWindows(
    cadence,
    byWindow,
    currentWindowLabel,
  );
  totalWindows += missedWindows;

  const pct =
    totalWindows > 0 ? Math.round((metWindows / totalWindows) * 100) : null;

  return {
    metWindows,
    totalWindows,
    missedWindows,
    pct,
    cadence,
    inProgress,
    windows,
  };
}

function empty() {
  return {
    metWindows: 0,
    totalWindows: 0,
    missedWindows: 0,
    pct: null,
    cadence: null,
    inProgress: null,
    windows: [],
  };
}

/* ── expected-window enumeration ── */

/** A date safely inside the window a label describes, or null when the
 *  label (or cadence) isn't enumerable. */
function windowAnchorDate(cadence, label) {
  if (typeof label !== "string") return null;
  let m;
  switch (cadence) {
    case "weekly":
      return weekRangeFromLabel(label)?.start ?? null;
    case "monthly":
      m = label.match(/^(\d{4})-(\d{2})$/);
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, 15) : null;
    case "quarterly":
      m = label.match(/^(\d{4})-Q([1-4])$/);
      return m ? new Date(Number(m[1]), (Number(m[2]) - 1) * 3, 15) : null;
    case "yearly":
      m = label.match(/^(\d{4})$/);
      return m ? new Date(Number(m[1]), 6, 1) : null;
    case "daily":
      m = label.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
        : null;
    default:
      // biweekly fortnights + "lifetime" aren't enumerated — they fall
      // back to the observed-windows-only denominator.
      return null;
  }
}

function stepWindow(cadence, d) {
  const next = new Date(d);
  switch (cadence) {
    case "weekly":
      next.setDate(next.getDate() + 7);
      return next;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      return next;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      return next;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1);
      return next;
    case "daily":
      next.setDate(next.getDate() + 1);
      return next;
    default:
      return null;
  }
}

/** Runaway guard — a daily goal enumerates at most ~1.5 years. */
const MAX_ENUMERATED_WINDOWS = 500;

function countMissedWindows(cadence, byWindow, currentWindowLabel) {
  // Earliest observed window = the enumeration anchor.
  let earliest = null;
  let earliestDate = null;
  for (const label of byWindow.keys()) {
    const d = windowAnchorDate(cadence, label);
    if (!d) continue;
    if (!earliestDate || d < earliestDate) {
      earliestDate = d;
      earliest = label;
    }
  }
  if (!earliest || !earliestDate) return 0;

  let missed = 0;
  let cursor = earliestDate;
  for (let i = 0; i < MAX_ENUMERATED_WINDOWS; i++) {
    const label = labelFor(cadence, cursor);
    // Stop at the current (in-progress) window — it isn't owed yet —
    // or when we've walked past "now" entirely (no current label for
    // this cadence).
    if (label == null || label === currentWindowLabel) break;
    if (cursor > new Date()) break;
    if (!byWindow.has(label)) missed += 1;
    cursor = stepWindow(cadence, cursor);
    if (!cursor) break;
  }
  return missed;
}

/** Cadence-window label for an arbitrary date — same grammar the
 *  snapshotter writes (capture-readings' cadenceWindowFor). */
function labelFor(cadence, date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  switch (cadence) {
    case "yearly":
      return `${year}`;
    case "quarterly":
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
    case "weekly":
      return `W${String(weekNumber(d)).padStart(2, "0")}-${year}`;
    case "daily":
      return `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    default:
      return null;
  }
}

/**
 * The cadence-window label for "now" — used to detect in-progress
 * windows that shouldn't yet count toward compliance.
 */
function currentCadenceWindow(cadence) {
  const d = new Date();
  // Biweekly keeps its fortnight grammar; everything else shares
  // labelFor so "now" and the snapshotter can never disagree on a key.
  // Local calendar components throughout — the old getUTC* read shifted
  // the date a day early for timezones ahead of UTC.
  if (cadence === "biweekly") {
    const fortnight = Math.ceil(weekNumber(d) / 2);
    return `${d.getFullYear()}-F${String(fortnight).padStart(2, "0")}`;
  }
  return labelFor(cadence, d);
}
