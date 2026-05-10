/**
 * localStorage-backed integrations store.
 *
 * Plain functions — no React. The React binding lives in
 * `use-integrations.js`. We broadcast changes via a custom event so
 * multiple tabs/hooks stay in sync.
 *
 * M7.8 mirror mode (PUSH-ONLY): every saveConnection / disconnect
 * fires the corresponding call against /api/v1/integrations. The
 * server encrypts tokens at rest (M6.1 envelope encryption) — local
 * stays plaintext for legacy compatibility with the existing Next.js
 * proxy routes that read x-devhub-token headers. NO pull on session
 * because the server's public list endpoint deliberately doesn't
 * return token bytes; pulling would not yield usable tokens. One-shot
 * upload of pre-existing localStorage entries happens via
 * /api/v1/migrate/import, not via this store.
 */

import {
  mirrorDisconnectAll,
  mirrorDisconnectProvider,
  mirrorSaveConnection,
} from "./integrations-sync";

const STORAGE_KEY = "espace-devhub:integrations";
const CHANGE_EVENT = "integrations:change";

export function readIntegrations() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function saveConnection(providerId, payload) {
  const all = readIntegrations();
  const merged = { ...all[providerId], ...payload, connectedAt: Date.now() };
  all[providerId] = merged;
  writeAll(all);
  // Mirror the merged result, not just the patch — the server's
  // POST /integrations uses replace semantics on (orgId, userId,
  // providerId), so we send the full effective shape.
  void mirrorSaveConnection(providerId, merged);
}

export function disconnectProvider(providerId) {
  const all = readIntegrations();
  delete all[providerId];
  writeAll(all);
  void mirrorDisconnectProvider(providerId);
}

export function disconnectAll() {
  writeAll({});
  void mirrorDisconnectAll();
}

export function isConnected(providerId) {
  const entry = readIntegrations()[providerId];
  return Boolean(entry?.accessToken || entry?.apiToken);
}

export const INTEGRATIONS_CHANGE_EVENT = CHANGE_EVENT;
