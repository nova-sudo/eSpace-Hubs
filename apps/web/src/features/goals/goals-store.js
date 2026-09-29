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
  /** Whether ANY `GET /goals` has settled (success OR failure) for the
   *  active session. The mount-effect in use-goals gates on this, not
   *  on `fetched` — gating on `fetched` meant a failed fetch left
   *  `fetched:false`, the effect refired, and the app hammered the API
   *  in a loop while the page showed an endless spinner. Reset (like
   *  everything here) on auth transitions; manual retries call
   *  fetchGoals() directly. */
  attempted: false,
  /** Last write/fetch error envelope ({code, message}) or null. */
  error: null,
  /** The L1 tree. Empty array until the first fetch lands. */
  l1s: [],
  /** Shared goals assigned to this user — the server's synthetic,
   *  read-only "Shared goals" L1 (0 or 1 element). Deliberately NOT in
   *  `l1s`: every mutation PUTs `l1s` back, and these belong to the
   *  manager who shared them. Read both via `useGoals().allGoals`. */
  assigned: [],
  /** Server `updatedAt` of the tree we hold (ISO string) — the
   *  optimistic-concurrency token PUT /goals echoes back. Null until
   *  the first fetch, or when the server has no tree yet. */
  updatedAt: null,
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
  // Drop any coalesced edit and any queued save — they belonged to the
  // previous session. A PUT already on the wire is ignored when it lands
  // (see `sessionGen`).
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  pendingPrevL1s = null;
  queuedSave = null;
  saveTail = Promise.resolve();
  sessionGen += 1;
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
        attempted: true,
        // Auth failures are normal during logout flushes; not an error
        // state the user needs to see.
        error: isAuth ? null : r.error,
      });
      return state.l1s;
    }
    const l1s = Array.isArray(r.data?.l1s) ? r.data.l1s : [];
    setState({
      loading: false,
      fetched: true,
      attempted: true,
      error: null,
      l1s,
      assigned: Array.isArray(r.data?.assigned) ? r.data.assigned : [],
      updatedAt: r.data?.updatedAt ?? null,
    });
    return l1s;
  })();
  return inflightFetch;
}

/* ─── Save queue ─────────────────────────────────────────────────────
 * Every save sends THE CURRENT LOCAL TREE (`state.l1s` at send time) with
 * the concurrency token we hold AT SEND TIME. Saves are serialised: only
 * one PUT is on the wire at once, and the next one waits for it so it can
 * echo the `updatedAt` that PUT returned. Two PUTs racing on the same token
 * made the second 409, the store adopt the server tree, and whatever was
 * typed between them vanish.
 *
 * Saves that queue up behind an in-flight PUT coalesce into ONE follow-up
 * send — it reads the tree when it starts, so it carries every edit made
 * meanwhile. (A replace-import's `archiveCurrent` never coalesces: that
 * flag belongs to exactly one write.)
 */
let saveTail = Promise.resolve(); // settles when the last queued save does
let queuedSave = null; // the save waiting for the wire, if any
let saveInFlight = false;
let sessionGen = 0; // bumped by resetGoals — stale responses are dropped

function queueSave(prevL1s, options = {}) {
  if (queuedSave && !options.archiveCurrent && !queuedSave.options.archiveCurrent) {
    return queuedSave.promise;
  }
  const entry = { prevL1s, options, promise: null };
  const gen = sessionGen;
  entry.promise = saveTail.then(() => {
    if (queuedSave === entry) queuedSave = null;
    if (gen !== sessionGen) return { ok: false, error: { code: "session_changed", message: "Signed out before the save ran." } };
    return sendTree(entry.prevL1s, entry.options);
  });
  saveTail = entry.promise.catch(() => {});
  queuedSave = entry;
  return entry.promise;
}

/**
 * PUT the current tree. Resolves `{ ok, error }`. `prevL1s` is the tree to
 * roll back to on a plain failure — the tree from BEFORE the first edit
 * this save carries.
 */
async function sendTree(prevL1s, options = {}, init = undefined) {
  const gen = sessionGen;
  const sent = state.l1s;
  saveInFlight = true;
  let r;
  try {
    // Echo the concurrency token: the server 409s (goals_conflict) when
    // the stored tree moved under us, instead of letting this stale tab
    // silently wipe another device's edits.
    r = await apiPut(
      "/goals",
      {
        l1s: sent,
        updatedAt: state.updatedAt,
        // Replace imports send an archive label so the outgoing tree is
        // frozen into goal_cycles instead of destroyed (F2 v1).
        ...(options.archiveCurrent ? { archiveCurrent: options.archiveCurrent } : {}),
      },
      init,
    );
  } finally {
    saveInFlight = false;
  }
  // Signed out (or in as someone else) while this was on the wire.
  if (gen !== sessionGen) return r.ok ? { ok: true } : { ok: false, error: r.error };
  if (!r.ok) {
    if (r.error?.code === "goals_conflict") {
      // Adopt the live tree the 409 carried (or refetch as a fallback)
      // so the next save starts from reality, and keep the error so the
      // editor can tell the user their last edit needs re-applying.
      const current = r.error?.details?.current;
      if (current && Array.isArray(current.l1s)) {
        setState({
          l1s: current.l1s,
          ...(Array.isArray(current.assigned) ? { assigned: current.assigned } : {}),
          updatedAt: current.updatedAt ?? null,
          fetched: true,
          attempted: true,
          error: r.error,
        });
      } else {
        setState({ l1s: prevL1s, error: r.error });
        void fetchGoals();
      }
    } else if (state.l1s === sent) {
      setState({ l1s: prevL1s, error: r.error });
    } else {
      // Edits landed while this PUT was out — rolling back would throw
      // them away too. Keep them; the save queued behind retries them.
      setState({ error: r.error });
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[goals] save failed:",
      r.error?.code,
      r.error?.message,
    );
    return { ok: false, error: r.error };
  }
  // A successful save advances the token — without this, the NEXT save
  // from this tab would conflict against its own write.
  setState({ updatedAt: r.data?.updatedAt ?? state.updatedAt });
  return { ok: true };
}

/**
 * Apply a new l1s list locally at once (optimistic), then queue a save.
 * Resolves `{ ok, error }` so callers that need to know (imports, toasts)
 * can await it.
 */
function persistL1s(nextL1s, options = {}, prevL1s = state.l1s) {
  setState({ l1s: nextL1s, error: null });
  return queueSave(prevL1s, options);
}

/* ─── Debounced field edits ──────────────────────────────────────────
 * Typing into a title used to PUT the whole tree on EVERY keystroke.
 * Field edits now update local state at once (inputs stay controlled) and
 * coalesce into one save ~600ms after the last keystroke; the save queue
 * above keeps those saves from racing each other. Structural mutations
 * (add / remove / import) flush the pending edit first so the order of
 * writes matches the order of edits.
 */
const EDIT_DEBOUNCE_MS = 600;
let pendingTimer = null;
let pendingPrevL1s = null; // tree before the FIRST coalesced edit

function persistL1sDebounced(nextL1s) {
  if (pendingPrevL1s === null) pendingPrevL1s = state.l1s;
  setState({ l1s: nextL1s, error: null });
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => void flushPendingGoalsSave(), EDIT_DEBOUNCE_MS);
}

/** Send the coalesced edit now. Resolves once its save settles. */
export function flushPendingGoalsSave() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (pendingPrevL1s === null) return Promise.resolve({ ok: true });
  const prev = pendingPrevL1s;
  pendingPrevL1s = null;
  return queueSave(prev);
}

/** Browsers cap the total body of in-flight keepalive requests at 64 KiB. */
const KEEPALIVE_BODY_LIMIT = 60 * 1024;

/**
 * Tab closing mid-debounce: send the pending edit NOW with `keepalive`, so
 * the browser lets the request outlive the page. This skips the queue —
 * waiting for an in-flight PUT's response can't work once the page is
 * gone — so it is best effort: if a PUT is still out, this one may 409.
 * A tree too big for keepalive goes as a normal request (which the browser
 * may cancel).
 */
export function flushGoalsOnPageHide() {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (pendingPrevL1s === null) return;
  const prev = pendingPrevL1s;
  pendingPrevL1s = null;
  let size = Infinity;
  try {
    size = new Blob([JSON.stringify({ l1s: state.l1s, updatedAt: state.updatedAt })]).size;
  } catch {
    /* size unknown → no keepalive */
  }
  void sendTree(prev, {}, size <= KEEPALIVE_BODY_LIMIT ? { keepalive: true } : undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushGoalsOnPageHide);
}

/** Test hook: true while a PUT /goals is on the wire. */
export function isGoalsSaveInFlight() {
  return saveInFlight;
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

/** Structural change: flush any coalesced field edit, then persist at once. */
function persistStructural(nextL1sFn, options) {
  // Queue the coalesced edit first (it may merge with this save — both
  // send the current tree), then apply + queue the structural change.
  void flushPendingGoalsSave();
  return persistL1s(nextL1sFn(state.l1s), options);
}

export function addL1() {
  void persistStructural((l1s) => [...l1s, emptyL1()]);
}

export function updateL1(id, patch) {
  persistL1sDebounced(
    state.l1s.map((l1) => (l1.id === id ? { ...l1, ...patch } : l1)),
  );
}

export function removeL1(id) {
  void persistStructural((l1s) => l1s.filter((l1) => l1.id !== id));
}

export function addL2(l1Id) {
  void persistStructural((l1s) =>
    l1s.map((l1) =>
      l1.id === l1Id ? { ...l1, l2s: [...l1.l2s, emptyL2()] } : l1,
    ),
  );
}

export function updateL2(l1Id, l2Id, patch) {
  persistL1sDebounced(
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
  void persistStructural((l1s) =>
    l1s.map((l1) => {
      if (l1.id !== l1Id) return l1;
      return { ...l1, l2s: l1.l2s.filter((l2) => l2.id !== l2Id) };
    }),
  );
}

export function clearGoals() {
  void persistStructural(() => []);
}

/**
 * Replace the entire goal tree (used by the Zoho import flow). Every
 * row is passed through the empty-record factory first so partial
 * imports never end up missing v2 fields. Resolves the persist result so
 * the importer can wait before claiming success.
 */
export async function replaceGoals(tree) {
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
  // A replace over a non-empty tree archives the outgoing one first —
  // importing next cycle's goals must never be a data-loss event.
  const hadGoals = state.l1s.length > 0;
  const archiveCurrent = hadGoals
    ? `Archived ${new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    : null;
  return persistStructural(() => l1s, archiveCurrent ? { archiveCurrent } : {});
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
  return replaceGoals(getTestGoals());
}

/**
 * Append new L1s on top of the existing tree. Dedupes by `code` when
 * set. Resolves `{ ok, error, added, skipped }` — `skipped` lists the L1s
 * dropped as duplicates so the importer can report them instead of
 * counting them as imported.
 */
export async function appendGoals(tree) {
  const existingCodes = new Set(
    state.l1s.map((l1) => l1.code).filter(Boolean),
  );
  const incoming = Array.isArray(tree?.l1s) ? tree.l1s : [];
  const deduped = [];
  const skipped = [];
  for (const l1 of incoming) {
    if (l1.code && existingCodes.has(l1.code)) skipped.push(l1);
    else deduped.push(l1);
  }
  const added = deduped.map((l1) => ({
    ...emptyL1(),
    ...l1,
    id: l1.id || uid(),
    l2s: Array.isArray(l1.l2s)
      ? l1.l2s.map((l2) => ({ ...emptyL2(), ...l2, id: l2.id || uid() }))
      : [],
  }));
  if (added.length === 0) return { ok: true, added, skipped };
  const res = await persistStructural((l1s) => [...l1s, ...added]);
  return { ...res, added, skipped };
}
