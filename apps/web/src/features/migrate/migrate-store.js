/**
 * One-shot localStorage→API migration marker.
 *
 * The marker is per-device by design: each browser/profile carries
 * its own legacy localStorage, and each device's first authenticated
 * load triggers one upload. Re-uploads from the same device are a
 * no-op server-side (every collection has a unique-keyed upsert,
 * except goal_inputs which is append-only — that's why we gate on
 * a marker rather than relying purely on server idempotency).
 *
 * Stored value: a JSON object with the completion timestamp and
 * the counts the server returned, so the UI can show "imported 14
 * goals, 3 specs, …" if it wants to. The presence of the key is
 * what matters; the body is informational.
 */

const MARKER_KEY = "espace-devhub:migrate-completed-at";

export function readMigrationMarker() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeMigrationMarker(counts) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      MARKER_KEY,
      JSON.stringify({ completedAt: Date.now(), counts: counts ?? null }),
    );
  } catch {
    // Storage quota or private-mode failure — fine to swallow. The
    // worst case is we retry the (idempotent) migration next session.
  }
}

/**
 * Test-only escape hatch. Not exposed in the public barrel; reach in
 * directly if you ever need to force a re-migration during dev.
 */
export function clearMigrationMarker() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(MARKER_KEY);
}

export const MIGRATION_MARKER_KEY = MARKER_KEY;
