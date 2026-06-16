"use client";

/**
 * API-direct store for classified GoalSpecs.
 *
 * History
 * ───────
 * Replaces the prior localStorage-primary + mirror store. The
 * <SpecsSync /> pull-and-merge mount is gone — hydration is now driven
 * by the consuming hook (useGoalSpecs) on session establishment.
 *
 * Same API-direct pattern as goals (C1), snapshots (C2), evidence (C3):
 * module-level state, useSyncExternalStore-friendly monotonic-tick
 * snapshot, idempotent hydration sharing an in-flight promise,
 * optimistic mutations with rollback on API failure, reset on
 * `auth:user-storage-cleared` so the next user's mount triggers a
 * fresh fetch.
 *
 * Spec shape is owned by `@espace-devhub/shared/goal-specs` — the same
 * validateSpec runs here and on the server, so a locally-accepted spec
 * passes server validation by construction.
 *
 * Backend: /api/v1/goal-specs
 *   GET         /          → { specs: {[goalId]: spec}, lastAnalyzedAt }
 *   PUT         /:goalId    → { spec, generatedAt }
 *   DELETE      /:goalId
 */

import { validateSpec } from "@espace-devhub/shared/goal-specs";
import { apiDelete, apiGet, apiPut } from "@/lib/api-client";

const CHANGE_EVENT = "goal-specs:change";

export const SPECS_CHANGE_EVENT = CHANGE_EVENT;
/** Legacy localStorage key — retained as an export for back-compat with
 *  any importer that referenced it. No longer used for persistence. */
export const SPECS_STORAGE_KEY = "espace-devhub:goal-specs";

/* ─────────────────────── state ─────────────────────── */

const INITIAL_STATE = Object.freeze({
  /** True while the initial `GET /goal-specs` is in flight. */
  loading: false,
  /** Whether the hydration GET has resolved for the active session. */
  fetched: false,
  /** Last fetch / write error envelope or null. */
  error: null,
  /** Map of `{ [goalId]: spec }`. */
  specs: {},
  /** Epoch ms of the latest spec generation (server's max generatedAt). */
  lastAnalyzedAt: 0,
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

/** Read the current state synchronously. */
export function getSpecsState() {
  return state;
}

/** Subscribe to state changes. Returns an unsubscribe. */
export function subscribeSpecs(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Monotonic tick for useSyncExternalStore — increments on every change.
 *  Consumers read the actual specs via readSpecs() / readValidSpecs(). */
export function getSpecsSnapshot() {
  return snapshotTick;
}
export function getSpecsServerSnapshot() {
  return 0;
}

/** Reset in-memory state. Called by the auth-transition listener. */
export function resetSpecs() {
  state = INITIAL_STATE;
  inflightFetch = null;
  bumpSnapshot();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetSpecs);
}

/* ─────────────────────── reads ─────────────────────── */

/**
 * Synchronous read of the whole store: `{ specs, lastAnalyzedAt }`.
 * Empty before hydration completes — pair with useGoalSpecs() to drive
 * the fetch.
 */
export function readSpecs() {
  return { specs: state.specs, lastAnalyzedAt: state.lastAnalyzedAt };
}

/**
 * Return a plain object `{ [goalId]: spec }` for just the valid specs.
 * Use readSpecs() when you need to surface validation errors.
 */
export function readValidSpecs() {
  const out = {};
  for (const [goalId, value] of Object.entries(state.specs)) {
    const res = validateSpec(value);
    if (res.ok) out[goalId] = res.spec;
  }
  return out;
}

/* ─────────────────────── hydration ─────────────────────── */

/**
 * Idempotent — concurrent callers share the in-flight promise. The
 * empty-server case replaces in-memory state with `{}` so a fresh
 * sign-in never inherits the prior user's specs.
 */
export async function fetchSpecs() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet("/goal-specs");
    inflightFetch = null;
    if (!r.ok) {
      const isAuth =
        r.error?.code === "unauthenticated" ||
        r.error?.code === "totp_required";
      setState({ loading: false, error: isAuth ? null : r.error });
      return state.specs;
    }
    const specs =
      r.data?.specs && typeof r.data.specs === "object" ? r.data.specs : {};
    const lastAnalyzedAt =
      typeof r.data?.lastAnalyzedAt === "number" ? r.data.lastAnalyzedAt : 0;
    setState({
      loading: false,
      fetched: true,
      error: null,
      specs,
      lastAnalyzedAt,
    });
    return specs;
  })();
  return inflightFetch;
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Save a spec, replacing any existing one for the same goalId.
 *
 * Stays SYNCHRONOUS-returning: validates locally and returns the
 * validateSpec result so the classifier's commit flow can branch on
 * `res.ok`. The API PUT fires in the background (optimistic insert +
 * targeted rollback on failure). The server runs the same validator,
 * so a locally-accepted spec passes server validation.
 */
export function saveSpec(spec) {
  // Locked tiers are the user's contract — a re-analysis (or any external
  // save) must NOT overwrite them. When the stored spec is locked, carry its
  // tiers/ladder + the lock flag onto the incoming spec before validating.
  // (Explicit tier edits go through `updateSpecTiers`, which bypasses this.)
  let input = spec;
  const existing = spec?.goalId ? state.specs[spec.goalId] : null;
  if (existing?.tiersLocked === true) {
    input = {
      ...spec,
      tiers: existing.tiers,
      tierScale: existing.tierScale,
      tiersLocked: true,
    };
  }
  const res = validateSpec(input);
  if (!res.ok) return res;
  const goalId = res.spec.goalId;
  setState({ specs: { ...state.specs, [goalId]: res.spec }, error: null });
  void putSpecRemote(goalId, res.spec);
  return res;
}

/**
 * Set a goal's achievement-tier criteria (the tier editor's save path).
 * `locked` true marks the criteria as user-owned so re-analysis preserves
 * them; false drops the lock (next re-analysis may regenerate). Bypasses
 * saveSpec's preserve guard because this IS the explicit user edit.
 */
export function updateSpecTiers(goalId, tiers, locked) {
  const existing = goalId ? state.specs[goalId] : null;
  if (!existing) return { ok: false, errors: ["no spec for goal"] };
  const res = validateSpec({ ...existing, tiers, tiersLocked: locked === true });
  if (!res.ok) return res;
  setState({ specs: { ...state.specs, [goalId]: res.spec }, error: null });
  void putSpecRemote(goalId, res.spec);
  return res;
}

async function putSpecRemote(goalId, spec) {
  const r = await apiPut(`/goal-specs/${encodeURIComponent(goalId)}`, spec);
  if (r.ok) {
    // Server owns generatedAt — thread it into lastAnalyzedAt so the
    // "last analyzed" marker tracks the server clock.
    const genTs = r.data?.generatedAt ? Date.parse(r.data.generatedAt) : 0;
    if (genTs && genTs > state.lastAnalyzedAt) {
      setState({ lastAnalyzedAt: genTs });
    }
    return;
  }
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  // Targeted rollback: drop only this spec, and only if a concurrent
  // save didn't overwrite it in the meantime.
  if (state.specs[goalId] === spec) {
    const next = { ...state.specs };
    delete next[goalId];
    setState({ specs: next, error: r.error });
  } else {
    setState({ error: r.error });
  }
  // eslint-disable-next-line no-console
  console.warn("[goal-specs] save failed:", r.error?.code, r.error?.message);
}

/** Remove a single spec by goalId. No-op when absent. */
export function removeSpec(goalId) {
  if (!goalId || !state.specs[goalId]) return;
  const removed = state.specs[goalId];
  const next = { ...state.specs };
  delete next[goalId];
  setState({ specs: next, error: null });
  void removeSpecRemote(goalId, removed);
}

async function removeSpecRemote(goalId, removed) {
  const r = await apiDelete(`/goal-specs/${encodeURIComponent(goalId)}`);
  if (r.ok) return;
  // 404 → server already doesn't have it; keep the optimistic removal.
  if (r.error?.code === "not_found" || r.status === 404) return;
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  // Rollback the removal if nothing re-created the entry meanwhile.
  if (!state.specs[goalId]) {
    setState({ specs: { ...state.specs, [goalId]: removed }, error: r.error });
  } else {
    setState({ error: r.error });
  }
  // eslint-disable-next-line no-console
  console.warn("[goal-specs] remove failed:", r.error?.code, r.error?.message);
}

/**
 * Wipe all specs (used by "Re-analyze all" after the user confirms).
 * Optimistically clears in-memory, then fires a DELETE per known goalId
 * so a refresh doesn't re-hydrate the old specs from the server.
 */
export function clearSpecs() {
  const ids = Object.keys(state.specs);
  setState({ specs: {}, lastAnalyzedAt: 0, error: null });
  if (ids.length === 0) return;
  void Promise.all(
    ids.map((id) =>
      apiDelete(`/goal-specs/${encodeURIComponent(id)}`).catch(() => null),
    ),
  );
}

/**
 * Record the completion timestamp of the latest full-tree analysis.
 *
 * Local marker only — the server derives lastAnalyzedAt from each
 * spec's generatedAt (refreshed on every PUT), so there's no dedicated
 * endpoint to set it. On the next hydration it's recomputed from the
 * server's view.
 */
export function markAnalyzedAt(ts = Date.now()) {
  setState({ lastAnalyzedAt: ts });
}

/**
 * Bulk replace — used by import / restore flows. Each incoming value is
 * validated; invalid ones are skipped and collected in `skipped`. Valid
 * specs are written in-memory and PUT to the API in the background.
 */
export function replaceSpecs(map) {
  const entries = Object.entries(map || {});
  const specs = {};
  const skipped = [];
  for (const [goalId, value] of entries) {
    const res = validateSpec({ ...value, goalId });
    if (res.ok) specs[goalId] = res.spec;
    else skipped.push({ goalId, errors: res.errors });
  }
  setState({ specs, lastAnalyzedAt: Date.now(), error: null });
  void Promise.all(
    Object.entries(specs).map(([goalId, spec]) =>
      apiPut(`/goal-specs/${encodeURIComponent(goalId)}`, spec).catch(
        () => null,
      ),
    ),
  );
  return { saved: Object.keys(specs).length, skipped };
}
