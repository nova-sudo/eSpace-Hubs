"use client";

/**
 * In-memory + API-backed grading verdict cache.
 *
 * History
 * ───────
 * This replaces the prior `grading-store.js` (localStorage) +
 * `grading-sync.js` (mirror layer) + `<GradingSync />` (lifecycle
 * pull). The old design persisted verdicts in localStorage with a
 * fire-and-forget mirror to Mongo. Two failure modes drove the
 * rewrite:
 *
 *   1. On a fresh session (different browser, new device, cleared
 *      cache), the dashboard widget would render empty until the
 *      <GradingSync /> useEffect tick eventually pulled and merged
 *      into localStorage. The SCORECARD-embedded rubric component
 *      saw the empty cache first and showed `0/0` while the
 *      expanded modal — opened after the sync settled — showed the
 *      real number. That's the "loading inconsistency" the user
 *      reported.
 *
 *   2. Goals already migrated to API-direct in C1 (goals-store.js).
 *      Keeping grading on its own bespoke mirror layer was a
 *      maintenance liability — same cross-user-leak class of bug we
 *      already fixed once.
 *
 * Now: the API is the only source of truth. State lives in a
 * module-level Map keyed by `(prId, rubricHash)`; useGradedPrs
 * subscribes via useSyncExternalStore. Writes optimistically update
 * the local Map and POST to the API in the background — failures
 * roll back the local entry and the next subscriber re-renders with
 * whatever was there before.
 *
 * Auth transitions
 * ────────────────
 * The auth feature dispatches `auth:user-storage-cleared` after
 * every login / logout / signup / accept-invite. We listen and
 * reset the in-memory Map so the next consumer that mounts triggers
 * a fresh fetch and never sees the prior user's verdicts. This is
 * the same contract goals-store.js follows.
 */

import { apiGet, apiPost } from "@/lib/api-client";

const CHANGE_EVENT = "grading:change";

export const GRADING_CHANGE_EVENT = CHANGE_EVENT;

/* ─────────────────────── state ─────────────────────── */

const INITIAL_STATE = {
  /** True while the initial `GET /grading-verdicts` is in flight. */
  loading: false,
  /** Whether the hydration GET has resolved for the active session
   *  (success OR captured error). Used to decide whether to render
   *  "loading…" vs "0 graded". */
  fetched: false,
  /** Last fetch error envelope or null. */
  error: null,
  /** Map<cacheKey, verdict>. cacheKey = `${prId}::${rubricHash}`. */
  verdicts: new Map(),
};

let state = INITIAL_STATE;
let inflightFetch = null;

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export function makeCacheKey(prId, rubricHash) {
  return `${String(prId)}::${rubricHash}`;
}

/** Read the current state synchronously. */
export function getVerdictsState() {
  return state;
}

/** Subscribe to state changes. Returns an unsubscribe. */
export function subscribeVerdicts(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Snapshot value for useSyncExternalStore. Must return a value that
 *  changes identity whenever the Map changes — we use a monotonically
 *  incrementing tick (set inside `setState` via the Map reference
 *  swap below). Returning `state` directly would create a new object
 *  every render, defeating React's bail-out. */
let snapshotTick = 0;
function bumpSnapshot() {
  snapshotTick += 1;
}
export function getVerdictsSnapshot() {
  return snapshotTick;
}
// Server-side snapshot: stable string so React doesn't tear during
// hydration when the module mounts on the server.
export function getVerdictsServerSnapshot() {
  return 0;
}

/** Clear in-memory state. Called by the auth-transition listener and
 *  exposed for tests. */
export function resetVerdicts() {
  state = { ...INITIAL_STATE, verdicts: new Map() };
  inflightFetch = null;
  bumpSnapshot();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetVerdicts);
}

/* ─────────────────────── reads ─────────────────────── */

/** Read a single verdict, or null. */
export function readVerdict(prId, rubricHash) {
  return state.verdicts.get(makeCacheKey(prId, rubricHash)) || null;
}

/* ─────────────────────── hydration ─────────────────────── */

/**
 * Idempotent — concurrent callers share the in-flight promise.
 *
 * Empty-server case sets `verdicts: new Map()` and `fetched: true`,
 * which REPLACES whatever was in memory. This is the same
 * cross-user-leak guard goals-store.js applies.
 */
export async function fetchVerdicts() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet("/grading-verdicts");
    inflightFetch = null;
    if (!r.ok) {
      const isAuth =
        r.error?.code === "unauthenticated" || r.error?.code === "totp_required";
      setState({
        loading: false,
        // Auth-failure on a public route is normal; don't bubble.
        error: isAuth ? null : r.error,
      });
      return state.verdicts;
    }
    const incoming = Array.isArray(r.data?.verdicts) ? r.data.verdicts : [];
    const next = new Map();
    for (const v of incoming) {
      // Server uses normalised string prId; we keep the same key
      // shape locally so reads from useGradedPrs match exactly.
      if (!v.prId || !v.rubricHash || !v.verdict) continue;
      next.set(makeCacheKey(v.prId, v.rubricHash), v.verdict);
    }
    bumpSnapshot();
    setState({ loading: false, fetched: true, error: null, verdicts: next });
    return next;
  })();
  return inflightFetch;
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Persist a verdict. Local state updates synchronously so the UI
 * re-renders immediately; the POST runs in the background. Failures
 * roll back the local entry.
 *
 * Errored verdicts (the grader threw / upstream 5xx'd) still call
 * here so we don't re-attempt grading on the next render. The local
 * Map keeps the `errored: true` flag; the API persists pass=false +
 * the failure reasoning (the server schema doesn't model `errored`
 * yet — it's a frontend concept).
 */
export async function saveVerdict(prId, rubricHash, verdict) {
  if (!prId || !rubricHash || !verdict) return;
  const key = makeCacheKey(prId, rubricHash);
  const prev = state.verdicts.get(key) || null;
  const nextMap = new Map(state.verdicts);
  nextMap.set(key, verdict);
  bumpSnapshot();
  setState({ verdicts: nextMap, error: null });

  // Send the canonical shape — strip frontend-only fields the API
  // schema rejects (`errored`), keep `pass / reasoning / violations`.
  const body = {
    prId: String(prId),
    rubricHash,
    verdict: {
      pass: !!verdict.pass,
      reasoning:
        typeof verdict.reasoning === "string" ? verdict.reasoning : "",
      violations: Array.isArray(verdict.violations)
        ? verdict.violations
            .map((v) => (typeof v === "string" ? v : ""))
            .filter(Boolean)
        : [],
    },
  };
  const r = await apiPost("/grading-verdicts", body);
  if (r.ok) return;
  // Auth failures are normal during anonymous browsing — no rollback.
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  // Real failure: roll back the optimistic write so the UI matches
  // what the server actually has.
  const rollback = new Map(state.verdicts);
  if (prev) rollback.set(key, prev);
  else rollback.delete(key);
  bumpSnapshot();
  setState({ verdicts: rollback, error: r.error });
  // eslint-disable-next-line no-console
  console.warn(
    "[grading] save failed:",
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Drop verdicts whose (prId, rubricHash) doesn't appear in the
 * supplied "current rubric hash per PR" map. Mirrors the GC pass the
 * old store did locally — now the API is authoritative, but we also
 * update the local Map immediately so the widget doesn't briefly
 * render stale entries between the prune POST landing and the next
 * fetch.
 */
export async function pruneUnrelated(currentRubricHashByPr) {
  if (!currentRubricHashByPr || typeof currentRubricHashByPr !== "object") {
    return;
  }
  // Local prune first — keep entries whose rubricHash matches the
  // current map for their PR.
  const nextMap = new Map();
  for (const [key, verdict] of state.verdicts) {
    const lastSep = key.lastIndexOf("::");
    if (lastSep < 0) continue;
    const prId = key.slice(0, lastSep);
    const rubricHash = key.slice(lastSep + 2);
    const expected = currentRubricHashByPr[prId];
    if (expected && rubricHash === expected) {
      nextMap.set(key, verdict);
    }
  }
  bumpSnapshot();
  setState({ verdicts: nextMap });

  // Then sync to the server.
  const r = await apiPost("/grading-verdicts/prune", {
    currentRubricHashByPr,
  });
  if (r.ok) return;
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[grading] prune failed:",
    r.error?.code,
    r.error?.message,
  );
}

/** Wipe local state — reserved for a future "reset grading cache"
 *  user action. Doesn't touch the API. Call DELETE /grading-verdicts
 *  separately if a server-side wipe is what you want. */
export function clearVerdicts() {
  state = { ...state, verdicts: new Map() };
  bumpSnapshot();
  emit();
}
