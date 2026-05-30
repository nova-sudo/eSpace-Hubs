"use client";

/**
 * In-memory + API-backed snapshot store.
 *
 * History
 * ───────
 * This replaces the prior localStorage-mirror layer
 * (`snapshots-store.js` + `snapshots-sync.js` + `<SnapshotsSync />`).
 * The old design wrote locally first, mirrored to the server, and
 * had a separate pull lifecycle. Two recurring failure modes drove
 * the rewrite:
 *
 *   1. Local writes that landed before the per-session pull
 *      completed could show stale aggregates ("0/15 graded" while
 *      the server had 14/15) for the first few seconds of a fresh
 *      session — same class of bug as the goals/grading races we
 *      already fixed in C1 and C4.
 *
 *   2. The mirror layer's manual-wins precedence had to be encoded
 *      in three places (local store, mirror sync, server controller)
 *      and stayed in sync only by luck. With the API as the only
 *      source of truth, precedence lives server-side and the local
 *      state is whatever the server returned.
 *
 * Now: the API is authoritative. State lives in a module-level
 * value; useSnapshots subscribes via useSyncExternalStore.
 * Mutations optimistically update local state and POST/PATCH/DELETE
 * to the API in the background — failures roll back and surface in
 * `error`.
 *
 * Auth transitions: the auth feature dispatches
 * `auth:user-storage-cleared` after wiping localStorage (logout,
 * login, signup, etc.). We listen and reset to the empty baseline.
 * The next consumer that mounts triggers a fresh fetchSnapshots.
 *
 * Snapshot v2 schema (unchanged from the previous store — the
 * server already returns this shape):
 *
 *   {
 *     week:        "W16-2026",
 *     capturedAt:  "2026-04-22T..." (ISO),
 *     capturedBy:  "auto" | "manual",
 *     merged:      8,
 *     reviews:     47,
 *     turnaround:  14,
 *     linkage:     94,
 *     rounds:      1.6,
 *     note:        "Idempotency patch …",
 *     goalReadings: { [goalId]: { cadence, cadenceWindow, cumulative, target, windowMet, onPace, weekContribution } },
 *     partial:     boolean,
 *     gaps:        string[],
 *   }
 */

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";

const CHANGE_EVENT = "snapshots:change";

export const SNAPSHOTS_CHANGE_EVENT = CHANGE_EVENT;

/** Max snapshots we'll ever ask the API to return in one shot. The
 *  /snapshots listQuerySchema caps at 250; we ask for the ceiling
 *  so a fresh hydration sees the user's full history. */
const SNAPSHOTS_LIST_LIMIT = 250;

/* ─────────────────────── state ─────────────────────── */

const INITIAL_STATE = Object.freeze({
  /** True while the initial `GET /snapshots` is in flight. */
  loading: false,
  /** Whether the hydration GET has resolved for the active session. */
  fetched: false,
  /** Last fetch / write error envelope or null. */
  error: null,
  /** Snapshots array sorted by week descending. */
  snapshots: [],
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
export function getSnapshotsState() {
  return state;
}

/** Subscribe to state changes. Returns an unsubscribe. */
export function subscribeSnapshots(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Snapshot value for useSyncExternalStore. Monotonic tick — React
 *  uses it only to decide whether to re-read, the actual data comes
 *  from `readSnapshots()`. Same pattern as verdicts-store. */
export function getSnapshotsSnapshot() {
  return snapshotTick;
}
export function getSnapshotsServerSnapshot() {
  return 0;
}

/** Reset in-memory state. Called by the auth-transition listener
 *  and exposed for tests. */
export function resetSnapshots() {
  state = INITIAL_STATE;
  inflightFetch = null;
  bumpSnapshot();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetSnapshots);
}

/* ─────────────────────── reads ─────────────────────── */

/**
 * Synchronous read. Returns the current in-memory snapshot array
 * (sorted newest-first). Callers that haven't seen a fetch yet get
 * an empty array — they should pair this with `useSnapshots()` to
 * trigger hydration, or call `fetchSnapshots()` directly.
 */
export function readSnapshots() {
  return state.snapshots;
}

/* ─────────────────────── normalisation ─────────────────────── */

/**
 * Normalise a server-returned snapshot row. Same defaults the old
 * store applied — keeps consumers from having to handle "what if the
 * field is missing" for sparse rows.
 */
function normaliseSnapshot(s) {
  if (!s || typeof s !== "object") return null;
  return {
    week: typeof s.week === "string" ? s.week : "",
    capturedAt: typeof s.capturedAt === "string" ? s.capturedAt : null,
    capturedBy: s.capturedBy === "auto" ? "auto" : "manual",
    merged: Number.isFinite(s.merged) ? s.merged : 0,
    reviews: Number.isFinite(s.reviews) ? s.reviews : 0,
    turnaround: Number.isFinite(s.turnaround) ? s.turnaround : 0,
    linkage: Number.isFinite(s.linkage) ? s.linkage : 0,
    rounds: Number.isFinite(s.rounds) ? s.rounds : 0,
    note: typeof s.note === "string" ? s.note : "",
    goalReadings:
      s.goalReadings && typeof s.goalReadings === "object"
        ? s.goalReadings
        : {},
    partial: Boolean(s.partial),
    gaps: Array.isArray(s.gaps) ? s.gaps : [],
  };
}

/* ─────────────────────── hydration ─────────────────────── */

/**
 * Idempotent — concurrent callers share the in-flight promise.
 *
 * Empty-server case replaces whatever's in memory with `[]` (same
 * cross-user-leak guard goals-store + verdicts-store apply: a fresh
 * sign-in must never inherit the prior user's tree).
 */
export async function fetchSnapshots() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet(`/snapshots?limit=${SNAPSHOTS_LIST_LIMIT}`);
    inflightFetch = null;
    if (!r.ok) {
      const isAuth =
        r.error?.code === "unauthenticated" ||
        r.error?.code === "totp_required";
      setState({
        loading: false,
        error: isAuth ? null : r.error,
      });
      return state.snapshots;
    }
    const incoming = Array.isArray(r.data?.snapshots) ? r.data.snapshots : [];
    const normalized = incoming
      .map(normaliseSnapshot)
      .filter(Boolean)
      .sort((a, b) => b.week.localeCompare(a.week));
    setState({
      loading: false,
      fetched: true,
      error: null,
      snapshots: normalized,
    });
    return normalized;
  })();
  return inflightFetch;
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Persist a snapshot. Optimistic update + background POST.
 *
 * Server enforces manual-wins-over-auto: if the existing row is
 * manual and the incoming is auto, the response carries
 * `precedence: "manual_kept"` and the row is the prior (manual)
 * version. We accept whatever the server returned as canonical, so
 * the local state mirrors what the server actually persisted.
 *
 * On POST failure, the optimistic write rolls back to what was
 * there before. Auth failures are normal during anonymous browsing
 * — no rollback for those.
 */
export async function saveSnapshot(snapshot) {
  const incoming = normaliseSnapshot(snapshot);
  if (!incoming || !incoming.week) return;
  const prev = state.snapshots;
  // Optimistic: replace any existing snapshot for the same week.
  // The server may reject under manual-wins; we'll reconcile when
  // the POST returns.
  const optimistic = [
    incoming,
    ...prev.filter((s) => s.week !== incoming.week),
  ].sort((a, b) => b.week.localeCompare(a.week));
  setState({ snapshots: optimistic, error: null });
  const r = await apiPost("/snapshots", toApi(incoming));
  if (r.ok) {
    // Reconcile with the server's canonical row (it may have kept
    // a manual version we didn't know about).
    const serverRow = normaliseSnapshot(r.data?.snapshot);
    if (serverRow) {
      const reconciled = [
        serverRow,
        ...state.snapshots.filter((s) => s.week !== serverRow.week),
      ].sort((a, b) => b.week.localeCompare(a.week));
      setState({ snapshots: reconciled });
    }
    return;
  }
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  // Roll back the optimistic write — leave `prev` intact.
  setState({ snapshots: prev, error: r.error });
  // eslint-disable-next-line no-console
  console.warn("[snapshots] save failed:", r.error?.code, r.error?.message);
}

/**
 * Patch the note on an existing snapshot. Optimistic + PATCH.
 *
 * The note is the only field the user mutates in-place (the rest of
 * the snapshot is frozen at capture time). 404 = the snapshot
 * doesn't exist on the server yet, which can happen if the user
 * types a note before the snapshot's own POST has landed — we
 * roll back local and surface the error so the UI can retry.
 */
export async function updateSnapshotNote(week, note) {
  if (!week) return;
  const prev = state.snapshots;
  const optimistic = prev.map((s) =>
    s.week === week ? { ...s, note } : s,
  );
  setState({ snapshots: optimistic, error: null });
  const r = await apiPatch(`/snapshots/${encodeURIComponent(week)}`, { note });
  if (r.ok) return;
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  setState({ snapshots: prev, error: r.error });
  // eslint-disable-next-line no-console
  console.warn(
    "[snapshots] note patch failed:",
    r.error?.code,
    r.error?.message,
  );
}

/* ─────────────────────── deletes ─────────────────────── */

/**
 * Wipe every snapshot. Used by Settings → Danger → reset flow.
 *
 * Fires N delete requests in parallel — typical caps at ~60
 * snapshots per user so this is bounded. On any failure the local
 * cache reflects whatever the server-side deletes succeeded for,
 * then surfaces the first error.
 */
export async function clearSnapshots() {
  const prev = state.snapshots;
  setState({ snapshots: [], error: null });
  const results = await Promise.all(
    prev.map((s) =>
      apiDelete(`/snapshots/${encodeURIComponent(s.week)}`).catch((e) => ({
        ok: false,
        error: { code: "exception", message: String(e) },
      })),
    ),
  );
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return;
  // Some deletes failed — re-fetch from the server so local matches
  // what survived, and surface the first failure.
  // eslint-disable-next-line no-console
  console.warn(
    `[snapshots] clearSnapshots: ${failed.length}/${prev.length} deletes failed; refetching`,
  );
  setState({ error: failed[0].error });
  await fetchSnapshots();
}

/**
 * Remove only AUTO-captured snapshots, preserving MANUAL ones.
 * Used by Settings → "Reset auto & re-backfill" when a prior
 * backfill ran against broken integration data and the user wants
 * to re-synthesise from scratch.
 *
 * Same parallel-delete + reconcile pattern as `clearSnapshots`.
 */
export async function clearAutoSnapshots() {
  const prev = state.snapshots;
  const autoWeeks = prev.filter((s) => s.capturedBy === "auto");
  if (autoWeeks.length === 0) return;
  const optimistic = prev.filter((s) => s.capturedBy !== "auto");
  setState({ snapshots: optimistic, error: null });
  const results = await Promise.all(
    autoWeeks.map((s) =>
      apiDelete(`/snapshots/${encodeURIComponent(s.week)}`).catch((e) => ({
        ok: false,
        error: { code: "exception", message: String(e) },
      })),
    ),
  );
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[snapshots] clearAutoSnapshots: ${failed.length}/${autoWeeks.length} deletes failed; refetching`,
  );
  setState({ error: failed[0].error });
  await fetchSnapshots();
}

/* ─────────────────────── helpers ─────────────────────── */

/** Map local snapshot → API request body. Strips locally-derived
 *  fields the server doesn't accept; defaults capturedBy to manual
 *  when the caller forgot to set it (typical for useSnapshotNow,
 *  which captures user-driven snapshots). */
function toApi(s) {
  return {
    week: s.week,
    capturedAt: s.capturedAt ?? undefined,
    capturedBy: s.capturedBy === "auto" ? "auto" : "manual",
    merged: s.merged ?? 0,
    reviews: s.reviews ?? 0,
    turnaround: s.turnaround ?? 0,
    linkage: s.linkage ?? 0,
    rounds: s.rounds ?? 0,
    note: s.note ?? "",
    goalReadings: s.goalReadings ?? {},
    partial: !!s.partial,
    gaps: Array.isArray(s.gaps) ? s.gaps : [],
  };
}
