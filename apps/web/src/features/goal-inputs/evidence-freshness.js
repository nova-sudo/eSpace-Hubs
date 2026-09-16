/**
 * Evidence freshness — the second axis of a cadence window.
 *
 * `buildCycleWindows` already answers "did somebody log a reading for this
 * period", with states filled / settled / owed / current / future. That is the
 * FILL axis and it is about numbers.
 *
 * It says nothing about proof. A window can be filled with a reading nobody
 * can substantiate, and today that gap is silent: the person sees a complete
 * strip, the grader sees a number, and the absence of evidence only surfaces
 * months later as a verdict nobody can argue with. Compliance tooling solved
 * this a decade ago by making evidence a first-class state that EXPIRES per
 * period, so a hole is a visible, nagging, fixable status rather than a
 * discovery at review time.
 *
 * This module is that second axis. It is deliberately pure and deliberately
 * separate from the fill states: a window has a fill state AND a freshness
 * state, and conflating them is what produced the silence.
 *
 * ── Why "stale" is not the same as "missing" ─────────────────────────────
 * Evidence carried over from an earlier period is the interesting failure.
 * Somebody attached a document once, and every subsequent period points at
 * it. Nothing is missing, so no nag fires, and the goal reads as evidenced
 * when in truth one artifact is doing the work of four quarters. That reads
 * as STALE here, which is a distinct thing a person can act on.
 *
 * ── Why a current period is never "missing" ──────────────────────────────
 * Evidence for a period that has not closed is not late; it is not yet due.
 * Marking it missing would train people to ignore the state, which is the
 * one outcome that makes the whole idea worthless.
 */

/** A window's evidence state. Worst first, like the goal statuses. */
export const EVIDENCE_STATE = Object.freeze({
  MISSING: "missing",
  STALE: "stale",
  PENDING: "pending",
  ATTACHED: "attached",
  FUTURE: "future",
  NOT_REQUIRED: "not-required",
});

/** Tone + wording per state, in the design system's tint vocabulary. */
export const EVIDENCE_META = Object.freeze({
  [EVIDENCE_STATE.MISSING]: { tone: "peach", label: "No evidence" },
  [EVIDENCE_STATE.STALE]: { tone: "lemon", label: "Carried over" },
  [EVIDENCE_STATE.PENDING]: { tone: "neutral", label: "Not yet due" },
  [EVIDENCE_STATE.ATTACHED]: { tone: "mint", label: "Evidenced" },
  [EVIDENCE_STATE.FUTURE]: { tone: "neutral", label: "Upcoming" },
  [EVIDENCE_STATE.NOT_REQUIRED]: { tone: "neutral", label: "Not required" },
});

/** Severity order, worst first. Drives the goal-level rollup. */
export const EVIDENCE_SEVERITY = Object.freeze([
  EVIDENCE_STATE.MISSING,
  EVIDENCE_STATE.STALE,
  EVIDENCE_STATE.PENDING,
  EVIDENCE_STATE.ATTACHED,
  EVIDENCE_STATE.FUTURE,
  EVIDENCE_STATE.NOT_REQUIRED,
]);

/** States that mean a person has something to do. */
const ACTIONABLE = new Set([EVIDENCE_STATE.MISSING, EVIDENCE_STATE.STALE]);

export function isActionable(state) {
  return ACTIONABLE.has(state);
}

/** Does this goal ask for evidence at all? Opt-in, so nothing changes by default. */
export function requiresEvidence(spec) {
  return spec?.evidence?.requiredPerPeriod === true;
}

function instant(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v !== "string" || !v.trim()) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Evidence items pinned to a given window key.
 *
 * `files` are uploads with a `periodKey`; `entryEvidence` is the written
 * proof that already lives on an entry (a milestone item's evidence string, a
 * composed field's evidence). Both count — a linked pull request is evidence
 * just as much as an uploaded PDF, and treating only uploads as real is the
 * mislabel that made the evidence board count the wrong thing.
 */
function itemsForWindow(window, files, entryEvidence) {
  const key = window?.key;
  const out = [];
  for (const f of files || []) {
    if (f && f.periodKey === key) out.push({ at: instant(f.uploadedAt), source: "file" });
  }
  for (const e of entryEvidence || []) {
    if (e && e.periodKey === key) out.push({ at: instant(e.at), source: "entry" });
  }
  return out;
}

/**
 * One window's evidence state.
 *
 * @param {object} window   a buildCycleWindows() window ({ key, start, end, state })
 * @param {object} opts
 * @param {boolean} opts.required      does the goal ask for evidence
 * @param {Array}   opts.files         evidence files ({ periodKey, uploadedAt })
 * @param {Array}   opts.entryEvidence written proof ({ periodKey, at })
 * @param {number}  opts.now
 */
export function windowEvidenceState(window, { required, files, entryEvidence, now = Date.now() } = {}) {
  if (!required) return EVIDENCE_STATE.NOT_REQUIRED;
  if (!window) return EVIDENCE_STATE.NOT_REQUIRED;

  const start = Number(window.start);
  const end = Number(window.end);
  const items = itemsForWindow(window, files, entryEvidence);

  // Nothing attached: not yet due while the window is open or still ahead.
  if (items.length === 0) {
    if (Number.isFinite(end) && end > now) {
      return Number.isFinite(start) && start > now
        ? EVIDENCE_STATE.FUTURE
        : EVIDENCE_STATE.PENDING;
    }
    return EVIDENCE_STATE.MISSING;
  }

  // Attached, but produced before this window opened — one artifact doing the
  // work of several periods. An item with no timestamp is given the benefit of
  // the doubt: it was pinned to this period deliberately, and calling it stale
  // on missing metadata would punish older uploads for a field they predate.
  const dated = items.filter((i) => i.at != null);
  if (dated.length > 0 && Number.isFinite(start)) {
    const newest = Math.max(...dated.map((i) => i.at));
    if (newest < start) return EVIDENCE_STATE.STALE;
  }

  return EVIDENCE_STATE.ATTACHED;
}

/**
 * Evidence state for every window of a cycle, plus the rollup.
 *
 * `worst` is the goal's chip, following the same rule the goal roll-up uses:
 * a parent's number is an average, its status is its weakest child.
 */
export function cycleEvidence(cycle, { spec, files, entryEvidence, now = Date.now() } = {}) {
  const windows = Array.isArray(cycle?.windows) ? cycle.windows : [];
  const required = requiresEvidence(spec);

  const states = windows.map((w) => ({
    key: w?.key,
    label: w?.label,
    fill: w?.state,
    evidence: windowEvidenceState(w, { required, files, entryEvidence, now }),
  }));

  const counts = new Map();
  for (const s of states) counts.set(s.evidence, (counts.get(s.evidence) || 0) + 1);

  const worst =
    EVIDENCE_SEVERITY.find((k) => counts.get(k) > 0) || EVIDENCE_STATE.NOT_REQUIRED;

  const due = states.filter(
    (s) => s.evidence !== EVIDENCE_STATE.FUTURE && s.evidence !== EVIDENCE_STATE.NOT_REQUIRED,
  ).length;
  const evidenced = counts.get(EVIDENCE_STATE.ATTACHED) || 0;

  return {
    required,
    windows: states,
    worst,
    ...EVIDENCE_META[worst],
    missing: counts.get(EVIDENCE_STATE.MISSING) || 0,
    stale: counts.get(EVIDENCE_STATE.STALE) || 0,
    pending: counts.get(EVIDENCE_STATE.PENDING) || 0,
    attached: evidenced,
    // Null rather than 0% when nothing is due yet — the same rule the goal
    // roll-up follows, because "0% evidenced" on a cycle that has not started
    // is a false accusation rather than a measurement.
    pct: required && due > 0 ? Math.round((evidenced / due) * 100) : null,
  };
}

/**
 * The freshness picture as grader-facing prose.
 *
 * The point of saying this out loud is that a hole used to be SILENT. The
 * strip looked complete, the number was there, and nothing anywhere said "two
 * of these quarters have no proof behind them". Stating it turns a discovery
 * at review time into a fact on the page, and — crucially — tells the grader
 * what a hole does and does not license it to conclude.
 */
export function cycleEvidenceToText(summary) {
  if (!summary || !summary.required) return "";
  const { attached, stale, missing, pending, pct } = summary;
  if (attached + stale + missing + pending === 0) return "";

  const bits = [];
  if (attached) bits.push(`${attached} evidenced`);
  if (stale) bits.push(`${stale} carried over from an earlier period`);
  if (missing) bits.push(`${missing} with no evidence`);
  if (pending) bits.push(`${pending} still open`);

  const lines = [
    `evidence coverage: ${bits.join(", ")}${pct == null ? "" : ` (${pct}% of due periods evidenced)`}.`,
  ];

  if (stale > 0) {
    lines.push(
      `A carried-over period reuses an artifact produced before that period began. ` +
        `It is not proof for that period, but it is also not a fabrication — treat it as unevidenced, not as dishonest.`,
    );
  }
  if (missing > 0) {
    lines.push(
      `A period with no evidence means none was ATTACHED. The work may still have happened; ` +
        `absence of an attachment is not evidence of absence of work. Do not lower the tier for it ` +
        `unless the tier criteria themselves require documentation.`,
    );
  }
  return lines.join(" ");
}
