/**
 * Goal-oriented evidence derivation — pure, no React/IO.
 *
 * The Evidence page is about GOALS, not integration receipts. This turns the
 * per-goal readings (useGoalReadings) + the user's logged check-in entries
 * (goal-inputs) into a board grouped by L1: each goal carries its reading, its
 * status, and the concrete evidence the user logged against it (check-in notes,
 * per-item / per-field evidence, links).
 */

import { DAY_MS } from "@/lib/date";

const LINK_RE = /https?:\/\/\S+/;

/** Coarse tone → status bucket for the summary counts. */
const TONE_BUCKET = {
  ok: "onTrack",
  accent: "drifting",
  warn: "behind",
  muted: "awaiting",
};

function isLink(s) {
  return typeof s === "string" && LINK_RE.test(s);
}

/**
 * Pull the concrete evidence a user logged against one goal within the window:
 * check-in notes, per-checklist-item evidence (milestone / recurring), per-field
 * evidence + text values (composed), and free-text reflections. Newest first,
 * de-duped, capped.
 *
 * @returns {Array<{ text: string, link: boolean, ts: number }>}
 */
export function extractEvidenceItems(entries, cutoff, cap = 5) {
  const list = Array.isArray(entries) ? entries : [];
  const out = [];
  const seen = new Set();
  const add = (text, ts) => {
    const t = typeof text === "string" ? text.trim() : "";
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push({ text: t, link: isLink(t), ts });
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
      // composed widget — per-field evidence + text field values
      if (v.evidence && typeof v.evidence === "object") {
        for (const proof of Object.values(v.evidence)) {
          if (proof) add(String(proof), ts);
        }
      }
    } else if (typeof v === "string") {
      add(v, ts); // free-text reflection
    }
  }

  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, cap);
}

/**
 * Group per-goal readings into L1 shelves with each L2 goal's logged evidence.
 * @param {Array} readings  useGoalReadings() output ({goal,spec,level,parentL1,reading})
 * @param {Object} allInputs  readInputs() → { [goalId]: entries[] }
 * @param {number} days  window
 */
export function buildGoalEvidenceGroups(readings, allInputs, days, now = Date.now()) {
  const cutoff = now - days * DAY_MS;
  const groups = [];
  let active = null;
  const summary = { total: 0, onTrack: 0, drifting: 0, behind: 0, awaiting: 0 };

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
      const inWindow = entries.filter((e) => typeof e?.ts === "number" && e.ts >= cutoff);
      const lastTs = entries.length ? entries[entries.length - 1].ts : null;
      g.goals.push({
        goal: r.goal,
        spec: r.spec,
        reading: r.reading || null,
        evidence: extractEvidenceItems(entries, cutoff),
        entryCount: inWindow.length,
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
