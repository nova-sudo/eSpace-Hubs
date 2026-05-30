"use client";

/**
 * In-memory + API-backed evidence store.
 *
 * Holds the user's manually-starred review artifacts (merged PRs,
 * Jira tickets, review-comment clusters). Items have shape:
 *
 *   { id, kind: "merged-pr" | "ticket" | "review", ref, title, date, impact? }
 *
 * History
 * ───────
 * This replaces the prior localStorage-only store. There was no
 * mirror layer to begin with — evidence was purely client-side until
 * this migration. The backend collection lives under `evidence` with
 * the routes at `/api/v1/evidence/*`.
 *
 * Same API-direct pattern as goals (C1), grading (C4), and
 * snapshots (C2): module-level state, useSyncExternalStore-friendly
 * snapshot, optimistic mutations with rollback on API failure, reset
 * on `auth:user-storage-cleared` so the next user's mount triggers a
 * fresh fetch.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";

const CHANGE_EVENT = "evidence:change";

export const EVIDENCE_CHANGE_EVENT = CHANGE_EVENT;

/* ─────────────────────── state ─────────────────────── */

const INITIAL_STATE = Object.freeze({
  /** True while the initial `GET /evidence` is in flight. */
  loading: false,
  /** Whether the hydration GET has resolved for the active session. */
  fetched: false,
  /** Last fetch / write error envelope or null. */
  error: null,
  /** The starred items array — sorted newest-first by starredAt
   *  (server returns this order, we preserve it). */
  items: [],
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
export function getEvidenceState() {
  return state;
}

/** Subscribe to state changes. Returns an unsubscribe. */
export function subscribeEvidence(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Monotonic tick for useSyncExternalStore — increments whenever the
 *  store changes. Consumers read the actual items via readStarred(). */
export function getEvidenceSnapshot() {
  return snapshotTick;
}
export function getEvidenceServerSnapshot() {
  return 0;
}

/** Reset in-memory state. Called by the auth-transition listener. */
export function resetEvidence() {
  state = INITIAL_STATE;
  inflightFetch = null;
  bumpSnapshot();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetEvidence);
}

/* ─────────────────────── reads ─────────────────────── */

/** Synchronous read. Returns the in-memory starred-items array.
 *  Empty before hydration completes — pair with useStarredEvidence()
 *  to drive the fetch. */
export function readStarred() {
  return state.items;
}

/* ─────────────────────── hydration ─────────────────────── */

/**
 * Idempotent — concurrent callers share the in-flight promise.
 * Empty-server case replaces in-memory state with `[]` so a fresh
 * sign-in never inherits the prior user's items (same cross-user-leak
 * guard goals-store + snapshots-store apply).
 */
export async function fetchEvidence() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet("/evidence?limit=500");
    inflightFetch = null;
    if (!r.ok) {
      const isAuth =
        r.error?.code === "unauthenticated" ||
        r.error?.code === "totp_required";
      setState({ loading: false, error: isAuth ? null : r.error });
      return state.items;
    }
    const incoming = Array.isArray(r.data?.items) ? r.data.items : [];
    const normalized = incoming.map(toLocal).filter(Boolean);
    setState({
      loading: false,
      fetched: true,
      error: null,
      items: normalized,
    });
    return normalized;
  })();
  return inflightFetch;
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Add an item to the starred list. The frontend's existing
 * `toggleEvidence` (in `use-evidence.js`) decides whether to call
 * this or `unstarEvidence` based on current state; this function
 * unconditionally adds / refreshes.
 *
 * Optimistic: the new item appears at the top of the local list
 * immediately. The server's response replaces the optimistic row
 * with the canonical version (sets starredAt to the server's clock).
 */
export async function starEvidence(item) {
  if (!item || !item.id) return;
  const prev = state.items;
  // Optimistic: replace any existing entry with same id, prepend new.
  const optimisticItem = {
    id: item.id,
    kind: item.kind || "merged-pr",
    ref: item.ref ?? "",
    title: item.title ?? "",
    date: item.date ?? "",
    impact: item.impact ?? "",
    starredAt: new Date().toISOString(),
  };
  const optimistic = [
    optimisticItem,
    ...prev.filter((x) => x.id !== item.id),
  ];
  setState({ items: optimistic, error: null });

  const r = await apiPost("/evidence", {
    id: optimisticItem.id,
    kind: optimisticItem.kind,
    ref: optimisticItem.ref,
    title: optimisticItem.title,
    date: optimisticItem.date,
    impact: optimisticItem.impact,
  });
  if (r.ok) {
    const serverItem = toLocal(r.data?.item);
    if (serverItem) {
      const reconciled = [
        serverItem,
        ...state.items.filter((x) => x.id !== serverItem.id),
      ];
      setState({ items: reconciled });
    }
    return;
  }
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  // Rollback.
  setState({ items: prev, error: r.error });
  // eslint-disable-next-line no-console
  console.warn(
    "[evidence] star failed:",
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Remove an item from the starred list.
 *
 * Optimistic: the item disappears immediately. On API failure we
 * roll back. A 404 means the server already didn't have it — that's
 * a "success" outcome (server agrees the item is gone) so we keep
 * the optimistic removal.
 */
export async function unstarEvidence(id) {
  if (!id) return;
  const prev = state.items;
  const optimistic = prev.filter((x) => x.id !== id);
  setState({ items: optimistic, error: null });
  const r = await apiDelete(`/evidence/${encodeURIComponent(id)}`);
  if (r.ok) return;
  // 404 == server already has it removed → keep optimistic state.
  if (r.error?.code === "not_found" || r.status === 404) return;
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  setState({ items: prev, error: r.error });
  // eslint-disable-next-line no-console
  console.warn(
    "[evidence] unstar failed:",
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Toggle — adds if absent, removes if present. Backwards-compat
 * shim for the existing `toggleStar` / `toggleEvidence` callers.
 */
export function toggleStar(item) {
  if (!item || !item.id) return;
  const exists = state.items.find((x) => x.id === item.id);
  if (exists) {
    void unstarEvidence(item.id);
  } else {
    void starEvidence(item);
  }
}

/**
 * Patch the impact note on an existing starred item. Optimistic
 * with rollback on failure.
 */
export async function setImpact(id, impact) {
  if (!id) return;
  const prev = state.items;
  const optimistic = prev.map((x) =>
    x.id === id ? { ...x, impact } : x,
  );
  setState({ items: optimistic, error: null });
  const r = await apiPatch(`/evidence/${encodeURIComponent(id)}`, {
    impact,
  });
  if (r.ok) return;
  if (
    r.error?.code === "unauthenticated" ||
    r.error?.code === "totp_required"
  ) {
    return;
  }
  setState({ items: prev, error: r.error });
  // eslint-disable-next-line no-console
  console.warn(
    "[evidence] patch impact failed:",
    r.error?.code,
    r.error?.message,
  );
}

/* ─────────────────────── helpers ─────────────────────── */

/** Map API row → local-store shape. Returns null on a malformed row. */
function toLocal(s) {
  if (!s || typeof s !== "object") return null;
  return {
    id: typeof s.id === "string" ? s.id : "",
    kind: s.kind || "merged-pr",
    ref: typeof s.ref === "string" ? s.ref : "",
    title: typeof s.title === "string" ? s.title : "",
    date: typeof s.date === "string" ? s.date : "",
    impact: typeof s.impact === "string" ? s.impact : "",
    starredAt:
      typeof s.starredAt === "string" ? s.starredAt : null,
  };
}
