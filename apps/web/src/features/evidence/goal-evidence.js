/**
 * Goal-oriented evidence derivation — pure, no React/IO.
 *
 * The Evidence page is about GOALS, not integration receipts. This turns the
 * per-goal readings (useGoalReadings) + the user's logged check-in entries
 * (goal-inputs) into a board grouped by L1: each goal carries its reading, its
 * status, and the concrete evidence the user logged against it (check-in notes,
 * per-item / per-field evidence, links).
 */

import {
  countStatuses,
  isMeasurable,
  loggedPercent,
  loggedTotals,
  objectiveProgress,
  objectiveStatus,
  statusMeta,
  weightedProgress,
} from "@/features/goal-inputs";

const LINK_RE = /https?:\/\/\S+/;

/** Extract the first URL in a string, or null. */
function urlIn(s) {
  if (typeof s !== "string") return null;
  const m = s.match(LINK_RE);
  return m ? m[0] : null;
}

/** Distinct calendar days (UTC) among the timestamps — collapses the many
 *  micro-edit rows the accumulating widgets append in one sitting into one. */
export function distinctDays(tsList) {
  const days = new Set();
  for (const ts of tsList) days.add(new Date(ts).toISOString().slice(0, 10));
  return days.size;
}

/**
 * Pull the concrete evidence a user logged against one goal within the window:
 * check-in notes, per-checklist-item evidence (milestone / recurring), per-field
 * evidence (composed), incident post-mortem links, and free-text reflections.
 * Newest first, de-duped, capped. Each item carries the display `text` and, when
 * it contains a URL, the extracted `url` (the href — NOT the whole prefixed
 * "label: url" string, which would resolve as a broken relative link).
 *
 * @returns {Array<{ text: string, url: string|null, ts: number }>}
 */
export function extractEvidenceItems(entries, cutoff, cap = 5) {
  const list = Array.isArray(entries) ? entries : [];
  const out = [];
  const seen = new Set();
  const add = (text, ts) => {
    const t = typeof text === "string" ? text.trim() : "";
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push({ text: t, url: urlIn(t), ts });
  };

  for (const e of list) {
    const ts = typeof e?.ts === "number" ? e.ts : null;
    if (ts == null || ts < cutoff) continue;
    if (e.note) add(e.note, ts);
    const v = e.value;
    if (v && typeof v === "object") {
      // milestone / recurring-milestone checklist items with attached proof
      if (Array.isArray(v.items)) {
        for (const it of v.items) {
          if (it?.evidence) add(`${it.label}: ${it.evidence}`, ts);
        }
      }
      // composed widget — per-field evidence
      if (v.evidence && typeof v.evidence === "object") {
        for (const proof of Object.values(v.evidence)) {
          if (proof) add(String(proof), ts);
        }
      }
      // incident-log — the post-mortem link is the evidence
      if (v.link) add(String(v.link), ts);
    } else if (typeof v === "string") {
      add(v, ts); // free-text reflection
    }
  }

  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, cap);
}

/**
 * Group already-enriched per-goal readings into L1 shelves. Each L2 row is
 * enriched upstream (useGoalReadings) with its achievement verdict, its logged
 * evidence, check-in timing and its SHARED status (`row.status`, from
 * goal-inputs' goalStatus) — this only shelves them by L1 and rolls up.
 *
 * The roll-up is the same one Home and Goals print: each goal's "logged so
 * far" percent (due windows only), averaged per objective, weighted across
 * objectives; each objective's chip is its weakest MEASURED child. Goals
 * that aren't measured (no tracker, still in setup, auto-tracked) are
 * counted separately so the page can say they're not in the number.
 *
 * @param {Array} readings  useGoalReadings() output.
 * @param {Array} [untrackedGoals]  goals with no tracker at all
 *        (useGoalWidgetItems().unclassifiedGoals) — listed, never scored.
 */
export function buildGoalEvidenceGroups(readings, untrackedGoals = []) {
  const groups = [];
  let active = null;

  const ensureGroup = (l1) => {
    if (active && active.l1?.id === l1?.id) return active;
    active = { l1: l1 || { id: "_none", title: "Ungrouped" }, l1Reading: null, goals: [] };
    groups.push(active);
    return active;
  };

  const statuses = [];
  for (const r of readings || []) {
    if (r.level === "L1") {
      const g = ensureGroup(r.goal);
      g.l1Reading = r.reading || null;
    } else if (r.level === "L2") {
      const g = ensureGroup(r.parentL1);
      g.goals.push({
        goal: r.goal,
        spec: r.spec,
        reading: r.reading || null,
        status: r.status || null,
        verdict: r.verdict || null,
        evidence: r.evidence || [],
        checkinDays: r.checkinDays || 0,
        lastTs: r.lastTs || null,
      });
      if (r.status) statuses.push(r.status);
    }
  }

  const shelves = groups.filter((g) => g.goals.length > 0);
  for (const g of shelves) {
    const list = g.goals.map((row) => row.status).filter(Boolean);
    const key = objectiveStatus(list.map((st) => st.status));
    g.status = key ? { status: key, ...statusMeta(key) } : null;
    g.pct = objectiveProgress(list.map((st) => loggedPercent({ goal: st })));
  }

  const untracked = (untrackedGoals || []).filter((goal) => goal && goal.kind !== "L1");
  const unmeasuredTracked = statuses.filter((st) => !isMeasurable(st.status)).length;
  const summary = {
    total: statuses.length,
    counts: countStatuses(statuses.map((st) => st.status)),
    pct: weightedProgress(shelves.map((g) => ({ pct: g.pct, weight: g.l1?.weightage }))),
    logged: loggedTotals(statuses),
    // Not in the number: no tracker at all + trackers that can't be scored.
    unmeasured: untracked.length + unmeasuredTracked,
    untracked: untracked.map((goal) => ({ id: goal.id, title: goal.title })),
  };

  // Drop L1 shelves that ended up with no classified L2 goals.
  return { groups: shelves, summary };
}
