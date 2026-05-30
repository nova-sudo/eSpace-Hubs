"use client";

/**
 * API-direct store for manual goal inputs — a per-goal, append-only
 * time series keyed by goalId.
 *
 * History
 * ───────
 * Replaces the prior localStorage-primary + mirror store. The
 * <InputsSync /> pull-and-merge mount is gone — hydration is driven by
 * the consuming hooks (useGoalInputs / useAllGoalInputs) on session
 * establishment. Same API-direct pattern as goals (C1), snapshots (C2),
 * evidence (C3), specs/context (C5): module-level state, monotonic-tick
 * snapshot, idempotent fetch, optimistic writes with rollback, reset on
 * `auth:user-storage-cleared`.
 *
 * The store is intentionally dumb — no aggregation here. Widgets slice /
 * bucket their own entries because each has a different analysis mode
 * (sum for Counter, latest for Scale, fold for Milestone, etc).
 *
 * In-memory shape:
 *   { [goalId]: Array<{ id?, goalId, ts (epoch ms), value, note? }> }
 *   — each goal's list kept ts-ascending so `entries.at(-1)` is latest.
 *   `id` is the server's _id; present after hydration / append-reconcile
 *   so removes can DELETE directly. The only id-less window is between
 *   an optimistic append and its POST resolving.
 *
 * Backend: /api/v1/goal-inputs
 *   GET    /?goalId&since&until&limit  → { entries: [PublicEntry] } (ts DESC)
 *   POST   /     body { goalId, value, note?, ts?, source } → 201 PublicEntry
 *   DELETE /:entryId                   → { ok, deleted }
 */

import { validateInput } from "./schema";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";

const CHANGE_EVENT = "goal-inputs:change";

export const INPUTS_CHANGE_EVENT = CHANGE_EVENT;
/** Legacy localStorage key — retained as an export for back-compat with
 *  any importer that referenced it. No longer used for persistence. */
export const INPUTS_STORAGE_KEY = "espace-devhub:goal-inputs";

/* ─────────────────────── state ─────────────────────── */

const INITIAL_STATE = Object.freeze({
  loading: false,
  fetched: false,
  error: null,
  /** { [goalId]: entries[] } — each list ts-ascending. */
  byGoal: {},
});

let state = INITIAL_STATE;
let inflightFetch = null;
let snapshotTick = 0;

function bumpSnapshot() {
  snapshotTick += 1;
}

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function setState(patch) {
  state = { ...state, ...patch };
  bumpSnapshot();
  emit();
}

export function getInputsState() {
  return state;
}

export function subscribeInputs(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function getInputsSnapshot() {
  return snapshotTick;
}
export function getInputsServerSnapshot() {
  return 0;
}

export function resetInputs() {
  state = INITIAL_STATE;
  inflightFetch = null;
  bumpSnapshot();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetInputs);
}

function isAuthError(err) {
  return err?.code === "unauthenticated" || err?.code === "totp_required";
}

/* ─────────────────────── reads ─────────────────────── */

/** Return the full {goalId → entries[]} map. Entries sorted ts-ascending.
 *  Empty before hydration completes — pair with useGoalInputs() /
 *  useAllGoalInputs() to drive the fetch. */
export function readInputs() {
  return state.byGoal;
}

/** Return entries for a single goal (sorted ts-ascending). */
export function readGoalEntries(goalId) {
  if (!goalId) return [];
  const list = state.byGoal[goalId];
  return Array.isArray(list) ? list : [];
}

/* ─────────────────────── hydration ─────────────────────── */

/**
 * Idempotent — concurrent callers share the in-flight promise. The
 * empty-server case replaces in-memory state with `{}` so a fresh
 * sign-in never inherits the prior user's entries.
 */
export async function fetchInputs() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet("/goal-inputs?limit=2000");
    inflightFetch = null;
    if (!r.ok) {
      setState({ loading: false, error: isAuthError(r.error) ? null : r.error });
      return state.byGoal;
    }
    const incoming = Array.isArray(r.data?.entries) ? r.data.entries : [];
    const byGoal = {};
    for (const raw of incoming) {
      const e = toLocalEntry(raw);
      if (!e) continue;
      (byGoal[e.goalId] ||= []).push(e);
    }
    // Server sends ts DESC; widgets expect chronological order.
    for (const goalId of Object.keys(byGoal)) {
      byGoal[goalId].sort((a, b) => a.ts - b.ts);
    }
    setState({ loading: false, fetched: true, error: null, byGoal });
    return byGoal;
  })();
  return inflightFetch;
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Append a new entry. Returns the validation result so widgets can react
 * to bad inputs (e.g. show an inline error) — stays SYNCHRONOUS-returning.
 *
 * Optimistic: the entry appears locally immediately (without an id); the
 * POST fires in the background and reconciles the server's canonical row
 * (incl. id) back in. Rollback removes the optimistic entry on failure.
 */
export function appendEntry({ goalId, value, note, ts = Date.now() }) {
  const res = validateInput({ goalId, value, note, ts });
  if (!res.ok) return res;
  const optimistic = res.entry;
  const current = state.byGoal[goalId] || [];
  const nextList = [...current, optimistic].sort((a, b) => a.ts - b.ts);
  setState({ byGoal: { ...state.byGoal, [goalId]: nextList }, error: null });
  void appendEntryRemote(optimistic);
  return res;
}

async function appendEntryRemote(optimistic) {
  const goalId = optimistic.goalId;
  const r = await apiPost("/goal-inputs", {
    goalId,
    value: optimistic.value,
    note: optimistic.note ?? null,
    ts: new Date(optimistic.ts).toISOString(),
    source: "manual",
  });
  if (r.ok) {
    // Reconcile: swap the optimistic entry (by reference) for the
    // server's canonical version so subsequent removes have its id.
    const server = toLocalEntry(r.data);
    if (server) {
      const list = state.byGoal[goalId] || [];
      const idx = list.indexOf(optimistic);
      if (idx >= 0) {
        const nextList = [...list];
        nextList[idx] = server;
        nextList.sort((a, b) => a.ts - b.ts);
        setState({ byGoal: { ...state.byGoal, [goalId]: nextList } });
      }
    }
    return;
  }
  if (isAuthError(r.error)) return;
  // Rollback the optimistic insert (by reference).
  const list = state.byGoal[goalId] || [];
  if (list.includes(optimistic)) {
    const nextList = list.filter((e) => e !== optimistic);
    const nextByGoal = { ...state.byGoal };
    if (nextList.length > 0) nextByGoal[goalId] = nextList;
    else delete nextByGoal[goalId];
    setState({ byGoal: nextByGoal, error: r.error });
  } else {
    setState({ error: r.error });
  }
  // eslint-disable-next-line no-console
  console.warn("[goal-inputs] append failed:", r.error?.code, r.error?.message);
}

/**
 * Remove a specific entry. (goalId, ts) is the local primary key.
 * Optimistic: the entry disappears immediately; rollback re-inserts on
 * failure. A 404 means the server already lacks it — keep the removal.
 */
export function removeEntry(goalId, ts) {
  if (!goalId) return;
  const list = state.byGoal[goalId] || [];
  const target = list.find((e) => e.ts === ts);
  if (!target) return;
  const nextList = list.filter((e) => e !== target);
  const nextByGoal = { ...state.byGoal };
  if (nextList.length > 0) nextByGoal[goalId] = nextList;
  else delete nextByGoal[goalId];
  setState({ byGoal: nextByGoal, error: null });
  void removeEntryRemote(goalId, target);
}

async function removeEntryRemote(goalId, removed) {
  // Resolve the server id. After hydration / append-reconcile every
  // entry carries one; the only id-less window is between an optimistic
  // append and its POST resolving — fall back to a list-find by ts.
  let id = removed.id;
  if (!id) {
    const list = await apiGet(
      `/goal-inputs?goalId=${encodeURIComponent(goalId)}&limit=2000`,
    );
    if (!list.ok) {
      if (isAuthError(list.error)) return;
      reinsertEntry(goalId, removed, list.error);
      // eslint-disable-next-line no-console
      console.warn(
        "[goal-inputs] remove (list) failed:",
        list.error?.code,
        list.error?.message,
      );
      return;
    }
    const entries = Array.isArray(list.data?.entries) ? list.data.entries : [];
    const match = entries.find((e) => Date.parse(e.ts) === removed.ts);
    if (!match) return; // server never had it; optimistic removal stands
    id = match.id;
  }
  const del = await apiDelete(`/goal-inputs/${encodeURIComponent(id)}`);
  if (del.ok) return;
  if (del.error?.code === "not_found" || del.status === 404) return;
  if (isAuthError(del.error)) return;
  reinsertEntry(goalId, removed, del.error);
  // eslint-disable-next-line no-console
  console.warn(
    "[goal-inputs] remove (delete) failed:",
    del.error?.code,
    del.error?.message,
  );
}

/** Re-insert a rolled-back entry, keeping ts order and avoiding dupes. */
function reinsertEntry(goalId, entry, error) {
  const list = state.byGoal[goalId] || [];
  const dup = list.some(
    (e) => e === entry || (e.id && entry.id && e.id === entry.id),
  );
  if (dup) {
    setState({ error });
    return;
  }
  const nextList = [...list, entry].sort((a, b) => a.ts - b.ts);
  setState({ byGoal: { ...state.byGoal, [goalId]: nextList }, error });
}

/**
 * Wipe every entry for a single goal — used when re-analyzing. Optimistic
 * local clear, then list-then-delete-each on the server (fire-and-forget;
 * individual delete failures are absorbed). Rare, user-initiated.
 */
export function clearGoalEntries(goalId) {
  if (!goalId || !state.byGoal[goalId]) return;
  const removed = state.byGoal[goalId];
  const nextByGoal = { ...state.byGoal };
  delete nextByGoal[goalId];
  setState({ byGoal: nextByGoal, error: null });
  void clearGoalRemote(goalId, removed);
}

async function clearGoalRemote(goalId, removed) {
  const list = await apiGet(
    `/goal-inputs?goalId=${encodeURIComponent(goalId)}&limit=2000`,
  );
  if (!list.ok) {
    if (isAuthError(list.error)) return;
    // Couldn't enumerate — best-effort delete by ids we held locally.
    await Promise.all(
      (removed || [])
        .filter((e) => e.id)
        .map((e) =>
          apiDelete(`/goal-inputs/${encodeURIComponent(e.id)}`).catch(
            () => null,
          ),
        ),
    );
    return;
  }
  const entries = Array.isArray(list.data?.entries) ? list.data.entries : [];
  await Promise.all(
    entries.map((e) =>
      apiDelete(`/goal-inputs/${encodeURIComponent(e.id)}`).catch(() => null),
    ),
  );
}

/**
 * Replace all entries for a single goal (used for imports). Validates
 * each incoming entry; invalid ones are skipped and collected. Optimistic
 * local replace, then a background delete-all-then-post-all for the goal.
 */
export function replaceGoalEntries(goalId, entries) {
  if (!goalId) return { saved: 0, skipped: [] };
  const saved = [];
  const skipped = [];
  for (const entry of entries || []) {
    const res = validateInput({ ...entry, goalId });
    if (res.ok) saved.push(res.entry);
    else skipped.push({ entry, errors: res.errors });
  }
  saved.sort((a, b) => a.ts - b.ts);
  setState({ byGoal: { ...state.byGoal, [goalId]: saved }, error: null });
  void replaceGoalRemote(goalId, saved);
  return { saved: saved.length, skipped };
}

async function replaceGoalRemote(goalId, saved) {
  // Delete existing server rows for this goal, then POST the new set.
  const list = await apiGet(
    `/goal-inputs?goalId=${encodeURIComponent(goalId)}&limit=2000`,
  );
  if (list.ok) {
    const existing = Array.isArray(list.data?.entries) ? list.data.entries : [];
    await Promise.all(
      existing.map((e) =>
        apiDelete(`/goal-inputs/${encodeURIComponent(e.id)}`).catch(() => null),
      ),
    );
  } else if (isAuthError(list.error)) {
    return;
  }
  await Promise.all(
    saved.map(async (entry) => {
      const r = await apiPost("/goal-inputs", {
        goalId: entry.goalId,
        value: entry.value,
        note: entry.note ?? null,
        ts: new Date(entry.ts).toISOString(),
        source: "manual",
      });
      if (!r.ok) return;
      const server = toLocalEntry(r.data);
      if (!server) return;
      const cur = state.byGoal[goalId] || [];
      const idx = cur.indexOf(entry);
      if (idx >= 0) {
        const nextList = [...cur];
        nextList[idx] = server;
        nextList.sort((a, b) => a.ts - b.ts);
        setState({ byGoal: { ...state.byGoal, [goalId]: nextList } });
      }
    }),
  );
}

/* ─────────────────────── helpers ─────────────────────── */

/** Map an API PublicEntry → local-store shape (ts as epoch ms). Returns
 *  null on a malformed row. */
function toLocalEntry(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.goalId !== "string" || s.goalId === "") return null;
  const ms =
    typeof s.ts === "string"
      ? Date.parse(s.ts)
      : typeof s.ts === "number"
        ? s.ts
        : NaN;
  if (Number.isNaN(ms)) return null;
  return {
    ...(typeof s.id === "string" ? { id: s.id } : {}),
    goalId: s.goalId,
    ts: ms,
    value: s.value,
    note: s.note ?? undefined,
  };
}
