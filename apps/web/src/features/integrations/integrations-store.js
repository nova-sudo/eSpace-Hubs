/**
 * localStorage-backed integrations store.
 *
 * Plain functions — no React. The React binding lives in `use-integrations.js`.
 * We broadcast changes via a custom event so multiple tabs/hooks stay in sync.
 */

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
  all[providerId] = { ...all[providerId], ...payload, connectedAt: Date.now() };
  writeAll(all);
}

export function disconnectProvider(providerId) {
  const all = readIntegrations();
  delete all[providerId];
  writeAll(all);
}

export function disconnectAll() {
  writeAll({});
}

export function isConnected(providerId) {
  const entry = readIntegrations()[providerId];
  return Boolean(entry?.accessToken || entry?.apiToken);
}

export const INTEGRATIONS_CHANGE_EVENT = CHANGE_EVENT;
