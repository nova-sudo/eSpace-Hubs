/**
 * Goal-oriented evidence derivation — pure, no React/IO.
 *
 * The Evidence page is about GOALS, not integration receipts. This turns the
 * per-goal readings (useGoalReadings) + the user's logged check-in entries
 * (goal-inputs) into a board grouped by L1: each goal carries its reading, its
 * status, and the concrete evidence the user logged against it (check-in notes,
 * per-item / per-field evidence, links).
 */

import { startOfYearMs } from "@/lib/date";

const LINK_RE = /https?:\/\/\S+/;

/**
 * Coarse reading tone → summary bucket. Note the reading `accent` tone is
 * overloaded in goal-readings.js — it means "tracked / tracking / in progress"
 * for healthy states, NOT "drifting" — so it buckets as `inProgress`, never a
 * scary drift count that would contradict the goal cards' own "tracked" pill.
 */
const TONE_BUCKET = {
  ok: "onTrack",
  accent: "inProgress",
  warn: "behind",
  muted: "awaiting",
};

/** Extract the first URL in a string, or null. */
function urlIn(s) {
  if (typeof s !== "string") return null;
  const m = s.match(LINK_RE);
  return m ? m[0] : null;
}

/** Distinct calendar days (UTC) among the timestamps — collapses the many
 *  micro-edit rows the accumulating widgets append in one sitting into one. */
function distinctDays(tsList) {
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
 * Group per-goal readings into L1 shelves with each L2 goal's logged evidence.
 * Windowed to year-to-date — the L2s are annual goals, so evidence is counted
 * from Jan 1 of the current year onward.
 * @param {Array} readings  useGoalReadings() output ({goal,spec,level,parentL1,reading})
 * @param {Object} allInputs  readInputs() → { [goalId]: entries[] }
 */
export function buildGoalEvidenceGroups(readings, allInputs, now = Date.now()) {
  const cutoff = startOfYearMs(now);
  const groups = [];
  let active = null;
  const summary = { total: 0, onTrack: 0, inProgress: 0, behind: 0, awaiting: 0 };

  const ensureGroup = (l1) => {
    if (active && active.l1?.id === l1?.id) return active;
    active = { l1: l1 || { id: "_none", title: "Ungrouped" }, l1Reading: null, goals: [] };
    groups.push(active);
    return active;
  };

  for (const r of readings || []) {
    if (r.level === "L1") {
      const g = ensureGroup(r.goal);
      g.l1Reading = r.reading || null;
    } else if (r.level === "L2") {
      const g = ensureGroup(r.parentL1);
      const entries = allInputs?.[r.goal.id] || [];
      const inWindowTs = entries
        .filter((e) => typeof e?.ts === "number" && e.ts >= cutoff)
        .map((e) => e.ts);
      const lastTs = entries.length ? entries[entries.length - 1].ts : null;
      g.goals.push({
        goal: r.goal,
        spec: r.spec,
        reading: r.reading || null,
        evidence: extractEvidenceItems(entries, cutoff),
        // Distinct check-in DAYS, not raw rows — accumulating widgets
        // (composed / milestone / recurring) append a row per micro-edit, so
        // a raw count reads "12 check-ins" for one sitting.
        checkinDays: distinctDays(inWindowTs),
        lastTs,
      });
      summary.total += 1;
      const bucket = TONE_BUCKET[r.reading?.statusTone] || "awaiting";
      summary[bucket] += 1;
    }
  }

  // Drop L1 shelves that ended up with no classified L2 goals.
  return { groups: groups.filter((g) => g.goals.length > 0), summary };
}
