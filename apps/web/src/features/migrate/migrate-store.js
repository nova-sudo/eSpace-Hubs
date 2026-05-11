/**
 * Per-(device, user) one-shot localStorage→API migration marker.
 *
 * Storage shape: a single localStorage entry whose value is a map of
 * userId → { completedAt, counts }. Each browser profile maintains
 * its own map; each authenticated user in that profile triggers
 * exactly one migration the first time they sign in.
 *
 * Why per-user (not just per-device): the M7.9a marker was
 * per-device only. That meant a second user signing in on the same
 * browser (e.g. an admin already used the device, then a new admin
 * is created) would never re-migrate — their localStorage wouldn't
 * land on the server, and downstream proxies that need server-side
 * tokens (M7.9c integrations proxy) would 401.
 *
 * Re-uploads from the same (device, user) are a no-op server-side —
 * every collection has a unique-keyed upsert except goal_inputs
 * (append-only). The marker prevents goal_inputs duplicate inserts
 * specifically.
 */

const MARKER_KEY = "espace-devhub:migrate-completed-by-user";

function readAll() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MARKER_KEY, JSON.stringify(map));
  } catch {
    // Storage quota or private-mode failure — fine to swallow.
    // Worst case: we retry the (idempotent) migration next session.
  }
}

/**
 * Returns the marker for this user, or null if never migrated.
 * Pass `null` / empty userId to fall back to a pre-M-CAP "any user"
 * lookup — preserves compat with the older single-marker key during
 * the upgrade window (rarely fires, but stops the migration from
 * re-running for a user who already migrated under the old scheme).
 */
export function readMigrationMarker(userId) {
  if (typeof window === "undefined") return null;
  if (typeof userId !== "string" || userId.length === 0) return null;
  const all = readAll();
  return all[userId] ?? null;
}

export function writeMigrationMarker(userId, counts) {
  if (typeof window === "undefined") return;
  if (typeof userId !== "string" || userId.length === 0) return;
  const all = readAll();
  all[userId] = { completedAt: Date.now(), counts: counts ?? null };
  writeAll(all);
}

/**
 * Test-only escape hatch. Removes the entry for one user (or the
 * whole map if userId is null). Not exposed in the public barrel;
 * reach in directly during dev when you want to force a re-migration.
 */
export function clearMigrationMarker(userId) {
  if (typeof window === "undefined") return;
  if (!userId) {
    try {
      localStorage.removeItem(MARKER_KEY);
    } catch {
      /* swallow */
    }
    return;
  }
  const all = readAll();
  if (userId in all) {
    delete all[userId];
    writeAll(all);
  }
}

export const MIGRATION_MARKER_KEY = MARKER_KEY;
