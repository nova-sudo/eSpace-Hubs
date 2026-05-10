/**
 * localStorage-backed store for the user's manually-entered L1 / L2 goal
 * tree. Mirrors Zoho People's Performance Management → KRA / Goals module.
 *
 * Schema v2 (current):
 *
 *   {
 *     schemaVersion: 2,
 *     l1s: [
 *       {
 *         id:          string,  // local uuid
 *         code:        string,  // e.g. "R-L0-3-PSCS-L1-06" (optional, from Zoho)
 *         title:       string,  // the goal statement
 *         description: string,  // short explanation beyond the title
 *         rubric:      string,  // Not-achieved / Achieved / Over / Role-model criteria
 *         weightage:   number,  // 0-100 (should sum to 100 across L1s)
 *         category:    string,  // free-form tag: "delivery"|"quality"|"people"|…
 *         l2s: [
 *           {
 *             id:          string,
 *             code:        string,
 *             title:       string,
 *             description: string,  // NEW v2: Zoho's "Description" column
 *             rubric:      string,
 *             weightage:   number,  // weight within parent L1 (0-100)
 *             priority:    "low"|"medium"|"high"|"",
 *             startDate:   string,  // ISO YYYY-MM-DD
 *             dueDate:     string,  // ISO YYYY-MM-DD
 *             category:    string,
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * DELIBERATE removal from v1: `status` / `progress`. The AI Analyst now
 * derives progress per-goal via the widget it generates; the user no
 * longer self-reports it here.
 *
 * Migration: `readGoals()` detects pre-v2 records and promotes them in
 * memory (it doesn't rewrite storage until the next mutation, so a user
 * that opens then closes the app without editing stays safely on v1 on
 * disk).
 */

const STORAGE_KEY = "espace-devhub:goals";
const CHANGE_EVENT = "goals:change";

export const GOALS_CHANGE_EVENT = CHANGE_EVENT;
export const GOALS_SCHEMA_VERSION = 2;

/**
 * Priority presets — optional on every L2. Kept small + sortable. The AI
 * uses this as a signal for how to pick a widget (high-priority goals
 * often warrant an auto metric over a manual counter).
 */
export const GOAL_PRIORITIES = Object.freeze([
  { value: "", label: "—" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]);

/**
 * Classification tags. Intentionally limited to 5 buckets so the AI's
 * classification prompt can consume them without ballooning. "Other" is
 * the escape hatch for one-off goals.
 */
export const GOAL_CATEGORIES = Object.freeze([
  { value: "", label: "—" },
  { value: "delivery", label: "Delivery" },
  { value: "quality", label: "Quality" },
  { value: "people", label: "People / leadership" },
  { value: "innovation", label: "Innovation" },
  { value: "operations", label: "Operations / reliability" },
  { value: "other", label: "Other" },
]);

export function readGoals() {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return migrate(raw);
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return { schemaVersion: GOALS_SCHEMA_VERSION, l1s: [] };
}

/**
 * Accept any prior shape and promote it to the current schema in memory.
 * Disk stays untouched until the next write — lets users roll back.
 */
function migrate(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.l1s)) {
    return defaultState();
  }
  const l1s = raw.l1s.map((l1) => promoteL1(l1));
  return { schemaVersion: GOALS_SCHEMA_VERSION, l1s };
}

function promoteL1(l1) {
  if (!l1 || typeof l1 !== "object") return emptyL1();
  return {
    ...emptyL1(),
    ...l1,
    l2s: Array.isArray(l1.l2s) ? l1.l2s.map(promoteL2) : [],
  };
}

function promoteL2(l2) {
  if (!l2 || typeof l2 !== "object") return emptyL2();
  const out = { ...emptyL2(), ...l2 };
  // Drop legacy `status` explicitly — not in v2. We leave it off the
  // returned object even if it was persisted, so spec-consuming layers
  // don't accidentally read it.
  delete out.status;
  return out;
}

function writeAll(next) {
  if (typeof window === "undefined") return;
  const stamped = { ...next, schemaVersion: GOALS_SCHEMA_VERSION };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function uid() {
  return `g-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function emptyL1() {
  return {
    id: uid(),
    code: "",
    title: "",
    description: "",
    rubric: "",
    weightage: 0,
    category: "",
    l2s: [],
  };
}

function emptyL2() {
  return {
    id: uid(),
    code: "",
    title: "",
    description: "",
    rubric: "",
    weightage: 0,
    priority: "",
    startDate: "",
    dueDate: "",
    category: "",
  };
}

export function addL1() {
  const state = readGoals();
  state.l1s.push(emptyL1());
  writeAll(state);
}

export function updateL1(id, patch) {
  const state = readGoals();
  state.l1s = state.l1s.map((l1) => (l1.id === id ? { ...l1, ...patch } : l1));
  writeAll(state);
}

export function removeL1(id) {
  const state = readGoals();
  state.l1s = state.l1s.filter((l1) => l1.id !== id);
  writeAll(state);
}

export function addL2(l1Id) {
  const state = readGoals();
  state.l1s = state.l1s.map((l1) =>
    l1.id === l1Id ? { ...l1, l2s: [...l1.l2s, emptyL2()] } : l1,
  );
  writeAll(state);
}

export function updateL2(l1Id, l2Id, patch) {
  const state = readGoals();
  state.l1s = state.l1s.map((l1) => {
    if (l1.id !== l1Id) return l1;
    return {
      ...l1,
      l2s: l1.l2s.map((l2) => (l2.id === l2Id ? { ...l2, ...patch } : l2)),
    };
  });
  writeAll(state);
}

export function removeL2(l1Id, l2Id) {
  const state = readGoals();
  state.l1s = state.l1s.map((l1) => {
    if (l1.id !== l1Id) return l1;
    return { ...l1, l2s: l1.l2s.filter((l2) => l2.id !== l2Id) };
  });
  writeAll(state);
}

export function clearGoals() {
  writeAll(defaultState());
}

/**
 * Replace the entire goal tree (used by the Zoho import flow). Every row
 * is passed through the empty-record factory first so partial imports
 * never end up missing v2 fields.
 */
export function replaceGoals(tree) {
  const l1s = Array.isArray(tree?.l1s) ? tree.l1s : [];
  writeAll({
    l1s: l1s.map((l1) => ({
      ...emptyL1(),
      ...l1,
      id: l1.id || uid(),
      l2s: Array.isArray(l1.l2s)
        ? l1.l2s.map((l2) => ({
            ...emptyL2(),
            ...l2,
            id: l2.id || uid(),
          }))
        : [],
    })),
  });
}

/**
 * Replace the goal tree with the curated test set (one L2 per widget kind
 * + delegated + context-required cases). Used to exercise the AI Analyst
 * end-to-end without typing 13 goals by hand.
 *
 * Lazy-imports `test-goals` so the test data isn't part of the regular
 * client bundle on routes that don't use it.
 */
export async function loadTestGoals() {
  const { getTestGoals } = await import("./test-goals");
  replaceGoals(getTestGoals());
}

/**
 * Append new L1s on top of the existing tree. Dedupes by `code` when set.
 */
export function appendGoals(tree) {
  const state = readGoals();
  const existingCodes = new Set(state.l1s.map((l1) => l1.code).filter(Boolean));
  const incoming = Array.isArray(tree?.l1s) ? tree.l1s : [];
  const deduped = incoming.filter((l1) => !l1.code || !existingCodes.has(l1.code));
  writeAll({
    l1s: [
      ...state.l1s,
      ...deduped.map((l1) => ({
        ...emptyL1(),
        ...l1,
        id: l1.id || uid(),
        l2s: Array.isArray(l1.l2s)
          ? l1.l2s.map((l2) => ({ ...emptyL2(), ...l2, id: l2.id || uid() }))
          : [],
      })),
    ],
  });
}
