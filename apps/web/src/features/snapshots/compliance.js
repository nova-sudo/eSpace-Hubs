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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * @param {Array<Snapshot>} snapshots — newest-first array from readSnapshots()
 * @param {string} goalId
 * @returns {{
 *   metWindows:     number,
 *   totalWindows:   number,
 *   pct:            number | null,    // 0..100, null when no closed windows yet
 *   cadence:        string | null,
 *   inProgress: { cadenceWindow, cumulative, target, windowMet, onPace } | null,
 *   windows:        Array<{ cadenceWindow, reading, closed: boolean }>,
 * }}
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

  const pct =
    totalWindows > 0 ? Math.round((metWindows / totalWindows) * 100) : null;

  return {
    metWindows,
    totalWindows,
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
    pct: null,
    cadence: null,
    inProgress: null,
    windows: [],
  };
}

/**
 * The cadence-window label for "now" — used to detect in-progress
 * windows that shouldn't yet count toward compliance.
 */
function currentCadenceWindow(cadence) {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  switch (cadence) {
    case "yearly":
      return `${year}`;
    case "quarterly": {
      const q = Math.floor((month - 1) / 3) + 1;
      return `${year}-Q${q}`;
    }
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
    case "biweekly": {
      const wk = sunWeekNumber(d);
      return `${year}-F${String(Math.ceil(wk / 2)).padStart(2, "0")}`;
    }
    case "weekly":
      return `W${String(sunWeekNumber(d)).padStart(2, "0")}-${year}`;
    case "daily":
      return d.toISOString().slice(0, 10);
    default:
      return null;
  }
}

function sunWeekNumber(d) {
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const daysSinceJan1 = Math.floor((d.getTime() - jan1.getTime()) / DAY);
  return Math.floor(daysSinceJan1 / 7) + 1;
}
