"use client";

/**
 * In-memory + API-backed goal-tree store.
 *
 * History: this used to be a localStorage-mirrored store with a separate
 * sync layer (`goals-sync.js` + `GoalsSync` mount component). The mirror
 * created two cross-user data leaks:
 *
 *   1. `pullGoalsFromApi` short-circuited on empty server response,
 *      leaving stale local data intact when a fresh user signed in.
 *   2. `writeAll` POSTed the local tree to the API on every mutation,
 *      so any stale localStorage data got uploaded under the new
 *      session's user id.
 *
 * Fix: the API is now the only source of truth. State lives in a
 * module-level value; useGoals subscribes via useSyncExternalStore.
 * Mutations optimistically update local state and PUT to the API in
 * the background — failures roll back and surface in `error`.
 *
 * Auth transitions: the auth feature dispatches
 * `auth:user-storage-cleared` after wiping localStorage (logout, login,
 * signup, etc.). We listen and reset our in-memory state to the empty
 * baseline. The next consumer that mounts triggers a fresh `fetchGoals`.
 *
 * Schema v2:
 *
 *   {
 *     schemaVersion: 2,
 *     l1s: [
 *       {
 *         id, code, title, description, rubric, weightage, category,
 *         l2s: [
 *           {
 *             id, code, title, description, rubric, weightage,
 *             priority, startDate, dueDate, category,
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * DELIBERATE removal from v1: `status` / `progress`. The AI Analyst
 * now derives progress per-goal via the widget it generates.
 */

import { apiGet, apiPut } from "@/lib/api-client";

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

const INITIAL_STATE = {
  /** True while the initial `GET /goals` is in flight. */
  loading: false,
  /** Whether a successful `GET /goals` has completed for the active
   *  session. Used to gate "show empty state" UI vs "still loading." */
  fetched: false,
  /** Last write/fetch error envelope ({code, message}) or null. */
  error: null,
  /** The L1 tree. Empty array until the first fetch lands. */
  l1s: [],
};

let state = { ...INITIAL_STATE };
let inflightFetch = null;

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

/** Read the current state synchronously. Used by useSyncExternalStore
 *  + ad-hoc reads (e.g. the import-merge dedupe). */
export function getGoalsState() {
  return state;
}

/**
 * Subscribe to state changes. Returns an unsubscribe.
 */
export function subscribeGoals(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Clear in-memory state and the in-flight fetch promise. Called by
 *  the auth-transition listener below + exposed for tests. */
export function resetGoals() {
  state = { ...INITIAL_STATE };
  inflightFetch = null;
  emit();
}

// Reset state on every auth transition so the next user's mount
// triggers a fresh fetch and never sees the prior user's tree.
if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetGoals);
}

/**
 * Idempotent — multiple concurrent callers share the same in-flight
 * promise. Returns the resolved state's l1s on success, [] on failure.
 *
 * Empty-server case: setState({ l1s: [], fetched: true }) — this
 * REPLACES whatever was previously in memory, so a stale tree from a
 * prior session can't survive an empty pull.
 */
export async function fetchGoals() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet("/goals");
    inflightFetch = null;
    if (!r.ok) {
      // Don't blow away whatever might be in memory on a transient
      // failure — but DO mark loading false + capture the error so the
      // UI can show a banner.
      const isAuth =
        r.error?.code === "unauthenticated" || r.error?.code === "totp_required";
      setState({
        loading: false,
        // Auth failures are normal during logout flushes; not an error
        // state the user needs to see.
        error: isAuth ? null : r.error,
      });
      return state.l1s;
    }
    const l1s = Array.isArray(r.data?.l1s) ? r.data.l1s : [];
    setState({ loading: false, fetched: true, error: null, l1s });
    return l1s;
  })();
  return inflightFetch;
}

/**
 * Send a new l1s list to /goals. Optimistically updates local state;
 * rolls back on failure.
 */
async function persistL1s(nextL1s) {
  const prevL1s = state.l1s;
  setState({ l1s: nextL1s, error: null });
  const r = await apiPut("/goals", { l1s: nextL1s });
  if (!r.ok) {
    setState({ l1s: prevL1s, error: r.error });
    // eslint-disable-next-line no-console
    console.warn(
      "[goals] save failed:",
      r.error?.code,
      r.error?.message,
    );
  }
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

// ─── Back-compat read helper ─────────────────────────────────────────
// The pre-refactor store exposed `readGoals()` that synchronously
// returned `{ schemaVersion, l1s }`. We keep that shape so call sites
// that didn't expect async (e.g. AI analyst seeders) keep working.
// They'll see an empty tree until `fetchGoals()` completes; consumers
// that care about loading state should use `useGoals()` instead.
export function readGoals() {
  return { schemaVersion: GOALS_SCHEMA_VERSION, l1s: state.l1s };
}

// ─── Mutations ───────────────────────────────────────────────────────
// All are fire-and-forget from the caller's perspective. Optimistic
// update happens synchronously; PUT runs in background; failures roll
// back state and surface in `error`. Editor components subscribe to
// state via useGoals and re-render on either success or rollback.

export function addL1() {
  void persistL1s([...state.l1s, emptyL1()]);
}

export function updateL1(id, patch) {
  void persistL1s(
    state.l1s.map((l1) => (l1.id === id ? { ...l1, ...patch } : l1)),
  );
}

export function removeL1(id) {
  void persistL1s(state.l1s.filter((l1) => l1.id !== id));
}

export function addL2(l1Id) {
  void persistL1s(
    state.l1s.map((l1) =>
      l1.id === l1Id ? { ...l1, l2s: [...l1.l2s, emptyL2()] } : l1,
    ),
  );
}

export function updateL2(l1Id, l2Id, patch) {
  void persistL1s(
    state.l1s.map((l1) => {
      if (l1.id !== l1Id) return l1;
      return {
        ...l1,
        l2s: l1.l2s.map((l2) => (l2.id === l2Id ? { ...l2, ...patch } : l2)),
      };
    }),
  );
}

export function removeL2(l1Id, l2Id) {
  void persistL1s(
    state.l1s.map((l1) => {
      if (l1.id !== l1Id) return l1;
      return { ...l1, l2s: l1.l2s.filter((l2) => l2.id !== l2Id) };
    }),
  );
}

export function clearGoals() {
  void persistL1s([]);
}

/**
 * Replace the entire goal tree (used by the Zoho import flow). Every
 * row is passed through the empty-record factory first so partial
 * imports never end up missing v2 fields.
 */
export function replaceGoals(tree) {
  const incoming = Array.isArray(tree?.l1s) ? tree.l1s : [];
  const l1s = incoming.map((l1) => ({
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
  }));
  void persistL1s(l1s);
}

/**
 * Replace the goal tree with the curated test set (one L2 per widget
 * kind + delegated + context-required cases). Used to exercise the AI
 * Analyst end-to-end without typing 13 goals by hand.
 *
 * Lazy-imports `test-goals` so the test data isn't part of the regular
 * client bundle on routes that don't use it.
 */
export async function loadTestGoals() {
  const { getTestGoals } = await import("./test-goals");
  replaceGoals(getTestGoals());
}

/**
 * Append new L1s on top of the existing tree. Dedupes by `code` when
 * set.
 */
export function appendGoals(tree) {
  const existingCodes = new Set(
    state.l1s.map((l1) => l1.code).filter(Boolean),
  );
  const incoming = Array.isArray(tree?.l1s) ? tree.l1s : [];
  const deduped = incoming.filter(
    (l1) => !l1.code || !existingCodes.has(l1.code),
  );
  const next = [
    ...state.l1s,
    ...deduped.map((l1) => ({
      ...emptyL1(),
      ...l1,
      id: l1.id || uid(),
      l2s: Array.isArray(l1.l2s)
        ? l1.l2s.map((l2) => ({ ...emptyL2(), ...l2, id: l2.id || uid() }))
        : [],
    })),
  ];
  void persistL1s(next);
}
