/**
 * The ONE goal status model. Every surface that shows whether a goal is on
 * track — the dev's Home, the Goals page, Evidence, the review packet and the
 * manager's board — derives its word, its tint and its sentence from here.
 *
 * Why it lives in the shared package: the manager board is computed by the
 * API (it has no client-side window engine), and a second copy of "what does
 * Behind mean" on the server is exactly how the manager came to see a
 * slipping goal as "Tracking" in green while the dev's Home said "Behind".
 *
 * Pure: no React, no IO. Callers hand in facts they already hold — whether
 * there is a tracker, whether it's ready to log, whether it's auto-measured,
 * the cadence-window cycle (`buildCycleWindows`, ideally WITH the goal's
 * settle locks) and the displayed tier.
 *
 * ── The rules ───────────────────────────────────────────────────────────
 *   No tracker yet  no spec at all — not in any percentage.
 *   Needs setup     a tracker that can't be logged yet (setup questions,
 *                   waiting for approval, delegated, untrackable).
 *   Exceeding       graded Over achieved / Role model (a grade outranks the
 *                   logging record — the dev did the thing).
 *   Auto-tracked    measured from a code host / Jira; nothing to log. Reads
 *                   Behind only when graded Not achieved.
 *   Behind          a window that was DUE (ended, counted, not settled) has
 *                   nothing logged — or the goal is graded Not achieved.
 *                   "Gone quiet" is not a separate state: it is the reason
 *                   shown under Behind when 2+ due windows in a row are empty.
 *   Not logged      ready, nothing logged yet, and nothing overdue yet.
 *   On pace         everything due so far is logged (or settled).
 *
 * The CURRENT window is never "behind": the week isn't over. A goal whose
 * only gap is this week reads On pace — the Home queue may still ask for this
 * week's entry, but that is a chore, not a status.
 */

/** Status keys. Stable strings — they cross the API boundary. */
export const GOAL_STATUS = Object.freeze({
  BEHIND: "behind",
  NOT_LOGGED: "not-logged",
  NEEDS_SETUP: "needs-setup",
  /** No tracker yet. The key predates the label; kept for stored data. */
  UNCLASSIFIED: "unclassified",
  NO_TRACKER: "unclassified",
  ON_PACE: "on-pace",
  AUTO: "auto",
  EXCEEDING: "exceeding",
});

/**
 * One label, one tint, one sentence per state. Tone is a design-system tint
 * name (mint · sky · lav · peach · lemon · neutral), so a caller hands it
 * straight to `<Badge tone>`.
 */
export const STATUS_META = Object.freeze({
  [GOAL_STATUS.BEHIND]: {
    label: "Behind",
    tone: "peach",
    description: "Something that was due has nothing logged, or the goal was graded Not achieved.",
  },
  [GOAL_STATUS.NOT_LOGGED]: {
    label: "Not logged",
    tone: "lemon",
    description: "The tracker is ready. Nothing is logged yet, and nothing is overdue yet.",
  },
  [GOAL_STATUS.NEEDS_SETUP]: {
    label: "Needs setup",
    tone: "lemon",
    description: "Has a tracker that can't be logged yet: setup questions, approval, or someone else judges it.",
  },
  [GOAL_STATUS.UNCLASSIFIED]: {
    label: "No tracker yet",
    tone: "neutral",
    description: "No tracker yet, so this goal isn't in any percentage.",
  },
  [GOAL_STATUS.ON_PACE]: {
    label: "On pace",
    tone: "mint",
    description: "Everything due so far is logged.",
  },
  [GOAL_STATUS.AUTO]: {
    label: "Auto-tracked",
    tone: "lav",
    description: "Measured from GitHub, GitLab or Jira. Nothing to log.",
  },
  [GOAL_STATUS.EXCEEDING]: {
    label: "Exceeding",
    tone: "sky",
    description: "Graded Over achieved or Role model.",
  },
});

/**
 * Severity, worst first. Drives an objective's chip (its weakest measured
 * child) and the order summary badges appear in.
 */
export const SEVERITY = Object.freeze([
  GOAL_STATUS.BEHIND,
  GOAL_STATUS.NOT_LOGGED,
  GOAL_STATUS.NEEDS_SETUP,
  GOAL_STATUS.UNCLASSIFIED,
  GOAL_STATUS.ON_PACE,
  GOAL_STATUS.AUTO,
  GOAL_STATUS.EXCEEDING,
]);

/** States with no completion figure — excluded from every average. */
const UNMEASURABLE = new Set([
  GOAL_STATUS.AUTO,
  GOAL_STATUS.NEEDS_SETUP,
  GOAL_STATUS.UNCLASSIFIED,
]);

export function isMeasurable(status) {
  return !UNMEASURABLE.has(status);
}

/** A status's meta, falling back to "No tracker yet" for an unknown key. */
export function statusMeta(status) {
  return STATUS_META[status] ?? STATUS_META[GOAL_STATUS.UNCLASSIFIED];
}

const PERIOD_WORDS = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  biweekly: ["fortnight", "fortnights"],
  monthly: ["month", "months"],
  quarterly: ["quarter", "quarters"],
};

/** "week"/"weeks" for a cadence — "period"/"periods" when unknown. */
export function periodWords(cadence) {
  return PERIOD_WORDS[cadence] ?? ["period", "periods"];
}

function isWindowed(cycle) {
  return Boolean(cycle && cycle.mode !== "pip" && Array.isArray(cycle.windows));
}

/**
 * The honest "N of M logged" pair: of the windows that were DUE so far, how
 * many are logged or settled. A window is due once it has ended; windows
 * before the tracker existed and future windows never count. The current
 * window counts only once it's done — logging this week early is credit, an
 * empty in-progress week is not a miss.
 *
 * @returns {{ done:number, due:number, owed:number }|null} null for a goal
 *          without cadence windows.
 */
export function loggedSoFar(cycle) {
  if (!isWindowed(cycle)) return null;
  const cur = Number.isInteger(cycle.currentIndex) ? cycle.currentIndex : -1;
  let done = 0;
  let owed = 0;
  cycle.windows.forEach((w, i) => {
    const state = w?.state;
    if (state === "owed") {
      owed += 1;
      return;
    }
    if (state !== "filled" && state !== "settled") return;
    // Logged ahead of time (a window after the current one) is neither due
    // nor done yet. A backfilled window before the tracker existed counts —
    // `buildCycleWindows` keeps it in `total` too.
    if (cur >= 0 && i > cur) return;
    done += 1;
  });
  return { done, due: done + owed, owed };
}

/**
 * How many due windows in a row, walking back from the latest ended one, have
 * nothing logged. 2+ is "gone quiet".
 */
export function quietWindows(cycle) {
  if (!isWindowed(cycle)) return 0;
  const last = cycle.currentIndex >= 0 ? cycle.currentIndex - 1 : cycle.windows.length - 1;
  let n = 0;
  for (let i = last; i >= 0; i -= 1) {
    if (cycle.windows[i]?.state === "owed") n += 1;
    else break;
  }
  return n;
}

const EXCEEDING_TIERS = new Set(["over_achieved", "role_model"]);

/**
 * One goal's status.
 *
 * @param {object}  f
 * @param {boolean} f.hasTracker   a spec exists
 * @param {boolean} [f.ready=true] the readiness gate passed
 * @param {boolean} [f.auto=false] measured from integrations, nothing to log
 * @param {object}  [f.cycle]      buildCycleWindows() result (pip or windowed)
 * @param {boolean} [f.hasData]    any entry at all (non-windowed kinds)
 * @param {string}  [f.tier]       the displayed tier, or null
 * @param {string}  [f.cadence]    for the reason's period word
 * @returns {{ status:string, label:string, tone:string, description:string,
 *            reason:string|null, quiet:number, logged:{done,due,owed}|null }}
 */
export function goalStatus({
  hasTracker,
  ready = true,
  auto = false,
  cycle = null,
  hasData = false,
  tier = null,
  cadence = null,
} = {}) {
  const out = (status, reason = null, extra = {}) => ({
    status,
    ...STATUS_META[status],
    reason,
    quiet: 0,
    logged: null,
    ...extra,
  });

  if (!hasTracker) return out(GOAL_STATUS.UNCLASSIFIED);
  if (!ready) return out(GOAL_STATUS.NEEDS_SETUP);
  if (EXCEEDING_TIERS.has(tier)) {
    return out(GOAL_STATUS.EXCEEDING, null, { logged: loggedSoFar(cycle) });
  }
  if (auto) {
    return tier === "not_achieved"
      ? out(GOAL_STATUS.BEHIND, "Graded Not achieved")
      : out(GOAL_STATUS.AUTO);
  }

  if (isWindowed(cycle)) {
    const logged = loggedSoFar(cycle);
    const quiet = quietWindows(cycle);
    const [one, many] = periodWords(cadence ?? cycle.cadence);
    if (logged.owed > 0) {
      const reason =
        quiet >= 2
          ? `Gone quiet · ${quiet} ${many} with nothing logged`
          : `${logged.owed} ${logged.owed === 1 ? one : many} missed`;
      return out(GOAL_STATUS.BEHIND, reason, { quiet, logged });
    }
    const anyDone = (cycle.doneCount ?? cycle.filledCount ?? 0) > 0 || logged.done > 0;
    if (tier === "not_achieved") {
      return out(GOAL_STATUS.BEHIND, "Graded Not achieved", { logged });
    }
    if (!anyDone) return out(GOAL_STATUS.NOT_LOGGED, null, { logged });
    return out(GOAL_STATUS.ON_PACE, null, { logged });
  }

  // No windows (a one-time milestone, per-incident log, continuous).
  if (tier === "not_achieved") return out(GOAL_STATUS.BEHIND, "Graded Not achieved");
  if (hasData || tier) return out(GOAL_STATUS.ON_PACE);
  return out(GOAL_STATUS.NOT_LOGGED);
}

/** The weakest status in a list (worst first by SEVERITY). */
export function worstStatus(statuses) {
  let worst = null;
  let rank = Infinity;
  for (const s of statuses || []) {
    const i = SEVERITY.indexOf(s);
    const r = i < 0 ? SEVERITY.length : i;
    if (r < rank) {
      rank = r;
      worst = s;
    }
  }
  return worst;
}

/**
 * An objective's status: its weakest MEASURED child. Goals with no tracker,
 * still in setup, or auto-tracked don't drag an objective to "No tracker
 * yet" — only when nothing under it is measured does the objective take the
 * weakest of what's there.
 */
export function objectiveStatus(statuses) {
  const list = (statuses || []).filter(Boolean);
  const measured = list.filter((s) => isMeasurable(s));
  return worstStatus(measured.length > 0 ? measured : list);
}

/**
 * Ordered counts for summary badges, worst first.
 * @returns {Array<{status:string, count:number, tone:string, label:string, description:string}>}
 */
export function countStatuses(statuses) {
  const counts = new Map();
  for (const s of statuses || []) counts.set(s, (counts.get(s) || 0) + 1);
  return SEVERITY.filter((k) => counts.get(k) > 0).map((k) => ({
    status: k,
    count: counts.get(k),
    ...STATUS_META[k],
  }));
}
