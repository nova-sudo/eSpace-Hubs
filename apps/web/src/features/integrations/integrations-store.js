"use client";

/**
 * API-direct integrations store.
 *
 * History
 * ───────
 * Replaces the prior localStorage-primary + push-only mirror. Same
 * API-direct pattern as goals (C1), snapshots (C2), evidence (C3),
 * specs/context/inputs (C5): module-level state, monotonic-tick
 * snapshot, idempotent fetch, optimistic writes with rollback, reset on
 * `auth:user-storage-cleared`. Hydration is driven by the consuming
 * hook (useIntegrations) on session establishment.
 *
 * What lives here vs. the server
 * ──────────────────────────────
 * Token BYTES never touch this store. Outbound provider calls go
 * through the API's encrypted-at-rest proxy (it decrypts in-process),
 * so the browser has no need for the plaintext token. The server's
 * GET /integrations returns connection-state booleans (`connected`,
 * `hasAccessToken`, `hasApiToken`) plus non-secret metadata
 * (label / email / endpointUrl / scopes / identity). We hydrate that,
 * which is exactly enough to drive every consumer:
 *   - isConnected / connectedProviders  ← `connected`
 *   - header chip identity (`me`)        ← username / displayName / team
 *   - gitlab reviewRequests / github events ← username
 *
 * Net effect vs. the old store: a fresh device or a cleared
 * localStorage now reflects the TRUE connection state + identity from
 * the server, instead of showing every provider as disconnected.
 *
 * Writes
 * ──────
 *   saveConnection(providerId, payload)
 *     - payload carries a token  → POST /integrations (encrypts, replaces)
 *     - payload is identity-only → PATCH /integrations/:id (no tokens)
 *     Optimistic local merge first; reconcile from the server's public
 *     shape; rollback on non-auth failure.
 *   disconnectProvider / disconnectAll → DELETE.
 *
 * The one-shot legacy localStorage → API upload still happens via
 * /api/v1/migrate/import (it reads the raw legacy key directly, not
 * this store).
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";

const CHANGE_EVENT = "integrations:change";
export const INTEGRATIONS_CHANGE_EVENT = CHANGE_EVENT;

/* ─────────────────────── state ─────────────────────── */

const INITIAL_STATE = Object.freeze({
  loading: false,
  fetched: false,
  error: null,
  /** { [providerId]: localEntry } — see toLocalEntry for the shape. */
  byProvider: {},
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

export function getIntegrationsState() {
  return state;
}

export function subscribeIntegrations(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function getIntegrationsSnapshot() {
  return snapshotTick;
}
export function getIntegrationsServerSnapshot() {
  return 0;
}

export function resetIntegrations() {
  state = INITIAL_STATE;
  inflightFetch = null;
  bumpSnapshot();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetIntegrations);
}

function isAuthError(err) {
  return err?.code === "unauthenticated" || err?.code === "totp_required";
}

/* ─────────────────────── reads ─────────────────────── */

/** Return the full { providerId → localEntry } map. Empty before
 *  hydration completes — pair with useIntegrations() to drive the fetch. */
export function readIntegrations() {
  return state.byProvider;
}

/** Connected = the server says at least one token is on file. */
export function isConnected(providerId) {
  return Boolean(state.byProvider[providerId]?.connected);
}

/* ─────────────────────── hydration ─────────────────────── */

/**
 * Idempotent — concurrent callers share the in-flight promise. Replaces
 * the whole map so a fresh sign-in never inherits the prior user's
 * connections.
 */
export async function fetchIntegrations() {
  if (inflightFetch) return inflightFetch;
  setState({ loading: true, error: null });
  inflightFetch = (async () => {
    const r = await apiGet("/integrations");
    inflightFetch = null;
    if (!r.ok) {
      setState({ loading: false, error: isAuthError(r.error) ? null : r.error });
      return state.byProvider;
    }
    const incoming = Array.isArray(r.data?.integrations)
      ? r.data.integrations
      : [];
    const byProvider = {};
    for (const raw of incoming) {
      const e = toLocalEntry(raw);
      if (e) byProvider[e.providerId] = e;
    }
    setState({ loading: false, fetched: true, error: null, byProvider });
    return byProvider;
  })();
  return inflightFetch;
}

/* ─────────────────────── writes ─────────────────────── */

/**
 * Persist a connection or enrich one with identity metadata.
 *
 * Routing:
 *   - payload carries accessToken/apiToken → POST (connect / replace).
 *   - identity-only payload               → PATCH (profile, no tokens).
 *
 * Returns the network promise so token-validation flows can await the
 * write before hitting the proxy (which needs the encrypted credential
 * persisted server-side first). The promise never rejects — failures
 * roll back the optimistic local change and are logged.
 */
export function saveConnection(providerId, payload) {
  if (!providerId || !payload || typeof payload !== "object") {
    return Promise.resolve();
  }
  const prev = state.byProvider[providerId];
  const hasToken = Boolean(payload.accessToken || payload.apiToken);

  // Optimistic local merge — identity/metadata fields override only when
  // provided; connection flags flip true when a token is present.
  const optimistic = { ...(prev || {}), providerId };
  optimistic.label =
    typeof payload.label === "string"
      ? payload.label
      : (prev?.label ?? providerId);
  applyIfString(optimistic, payload, "username");
  applyIfString(optimistic, payload, "displayName");
  applyIfString(optimistic, payload, "avatarUrl");
  applyIfString(optimistic, payload, "team");
  applyIfString(optimistic, payload, "email");
  applyIfString(optimistic, payload, "endpointUrl");
  if (Array.isArray(payload.scopes)) optimistic.scopes = payload.scopes;
  if (typeof payload.expiresAt === "string") optimistic.expiresAt = payload.expiresAt;
  if (payload.accessToken) optimistic.hasAccessToken = true;
  if (payload.apiToken) optimistic.hasApiToken = true;
  optimistic.connected = Boolean(
    optimistic.hasAccessToken || optimistic.hasApiToken,
  );

  setState({
    byProvider: { ...state.byProvider, [providerId]: optimistic },
    error: null,
  });

  return hasToken
    ? saveConnectionRemote(providerId, payload, prev)
    : updateProfileRemote(providerId, payload, prev);
}

async function saveConnectionRemote(providerId, payload, prev) {
  const body = buildUpsertBody(providerId, payload);
  // Defensive: the connect-path guard already proved a token exists.
  if (!body.accessToken && !body.apiToken) return;
  const r = await apiPost("/integrations", body);
  if (r.ok) {
    reconcile(providerId, r.data);
    return;
  }
  if (isAuthError(r.error)) return;
  rollback(providerId, prev, r.error);
  warn("save", r.error);
}

async function updateProfileRemote(providerId, payload, prev) {
  const body = buildProfileBody(payload);
  if (Object.keys(body).length === 0) return;
  const r = await apiPatch(
    `/integrations/${encodeURIComponent(providerId)}`,
    body,
  );
  if (r.ok) {
    reconcile(providerId, r.data);
    return;
  }
  if (isAuthError(r.error)) return;
  if (r.error?.code === "not_found" || r.status === 404) {
    // No live server row to attach the profile to (e.g. an identity-only
    // save before any token was persisted). Keep the optimistic local
    // entry; a subsequent connect POST will create the row.
    return;
  }
  rollback(providerId, prev, r.error);
  warn("profile", r.error);
}

export function disconnectProvider(providerId) {
  if (!providerId) return;
  const prev = state.byProvider[providerId];
  if (prev !== undefined) {
    const nextByProvider = { ...state.byProvider };
    delete nextByProvider[providerId];
    setState({ byProvider: nextByProvider, error: null });
  }
  void disconnectRemote(providerId, prev);
}

async function disconnectRemote(providerId, prev) {
  const r = await apiDelete(`/integrations/${encodeURIComponent(providerId)}`);
  if (r.ok) return;
  if (r.error?.code === "not_found" || r.status === 404) return;
  if (isAuthError(r.error)) return;
  // Rollback the optimistic removal.
  if (prev !== undefined) {
    setState({
      byProvider: { ...state.byProvider, [providerId]: prev },
      error: r.error,
    });
  }
  warn("disconnect", r.error);
}

/**
 * Wipe every connection. Optimistic local clear, then delete each row on
 * the server. Lists from the server first so connections made on another
 * device (not in our local map) are also removed; falls back to the
 * locally-known ids if the list call fails. Fire-and-forget.
 */
export function disconnectAll() {
  const prev = state.byProvider;
  setState({ byProvider: {}, error: null });
  void disconnectAllRemote(prev);
}

async function disconnectAllRemote(prev) {
  const list = await apiGet("/integrations");
  let ids;
  if (list.ok) {
    ids = (Array.isArray(list.data?.integrations) ? list.data.integrations : [])
      .map((i) => i.providerId)
      .filter(Boolean);
  } else {
    if (isAuthError(list.error)) return;
    ids = Object.keys(prev || {});
  }
  await Promise.all(
    ids.map((id) =>
      apiDelete(`/integrations/${encodeURIComponent(id)}`).catch(() => null),
    ),
  );
}

/* ─────────────────────── write helpers ─────────────────────── */

/** Reconcile local state with the server's public shape after a write. */
function reconcile(providerId, pub) {
  const entry = toLocalEntry(pub);
  if (!entry) return;
  setState({ byProvider: { ...state.byProvider, [providerId]: entry } });
}

/** Restore a provider's pre-write entry (or remove it if there was none). */
function rollback(providerId, prev, error) {
  const nextByProvider = { ...state.byProvider };
  if (prev === undefined) delete nextByProvider[providerId];
  else nextByProvider[providerId] = prev;
  setState({ byProvider: nextByProvider, error });
}

function warn(op, error) {
  // eslint-disable-next-line no-console
  console.warn(`[integrations] ${op} failed:`, error?.code, error?.message);
}

/**
 * Build the POST body. Forwards only the fields the API's upsert schema
 * accepts; token bytes are sent once here (over TLS) and the server
 * encrypts them at rest. Identity strings ride along so the server can
 * persist them (it never returned them before M7.x).
 */
function buildUpsertBody(providerId, payload) {
  const body = {
    providerId,
    label: typeof payload.label === "string" ? payload.label : providerId,
  };
  if (payload.accessToken) body.accessToken = payload.accessToken;
  if (payload.apiToken) body.apiToken = payload.apiToken;
  if (payload.refreshToken) body.refreshToken = payload.refreshToken;
  if (typeof payload.email === "string") body.email = payload.email;
  if (typeof payload.endpointUrl === "string") body.endpointUrl = payload.endpointUrl;
  if (Array.isArray(payload.scopes)) body.scopes = payload.scopes;
  if (typeof payload.expiresAt === "string") body.expiresAt = payload.expiresAt;
  if (typeof payload.username === "string") body.username = payload.username;
  if (typeof payload.displayName === "string") body.displayName = payload.displayName;
  if (typeof payload.avatarUrl === "string") body.avatarUrl = payload.avatarUrl;
  if (typeof payload.team === "string") body.team = payload.team;
  return body;
}

/** Build the PATCH body — non-secret identity/label fields only. */
function buildProfileBody(payload) {
  const body = {};
  if (typeof payload.label === "string") body.label = payload.label;
  if (typeof payload.username === "string") body.username = payload.username;
  if (typeof payload.displayName === "string") body.displayName = payload.displayName;
  if (typeof payload.avatarUrl === "string") body.avatarUrl = payload.avatarUrl;
  if (typeof payload.team === "string") body.team = payload.team;
  return body;
}

function applyIfString(target, payload, key) {
  if (typeof payload[key] === "string") target[key] = payload[key];
}

/* ─────────────────────── shape mapping ─────────────────────── */

/**
 * Map an API PublicIntegration → local-store entry. Mirrors the public
 * shape verbatim (sans token bytes, which the server never sends).
 * Returns null on a malformed row.
 */
function toLocalEntry(p) {
  if (!p || typeof p !== "object") return null;
  if (typeof p.providerId !== "string" || p.providerId === "") return null;
  return {
    providerId: p.providerId,
    label: typeof p.label === "string" ? p.label : p.providerId,
    connected: Boolean(p.connected),
    hasAccessToken: Boolean(p.hasAccessToken),
    hasApiToken: Boolean(p.hasApiToken),
    hasRefreshToken: Boolean(p.hasRefreshToken),
    email: p.email ?? null,
    endpointUrl: p.endpointUrl ?? null,
    scopes: Array.isArray(p.scopes) ? p.scopes : [],
    username: p.username ?? null,
    displayName: p.displayName ?? null,
    avatarUrl: p.avatarUrl ?? null,
    team: p.team ?? null,
    connectedAt: p.connectedAt ?? null,
    expiresAt: p.expiresAt ?? null,
    lastUsedAt: p.lastUsedAt ?? null,
    lastErrorAt: p.lastErrorAt ?? null,
    lastError: p.lastError ?? null,
  };
}
