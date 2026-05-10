/**
 * "When did the user last open the dashboard?" — used by the
 * SinceLastVisitTile to compute "what's changed since you were last here".
 *
 * Stored as ISO timestamp in localStorage. Two values:
 *   `current` — the last-seen timestamp the tile compares against. Updated
 *               only after the user has been on /  for ≥ a few seconds, so
 *               accidentally tab-switching back doesn't reset the diff.
 *   `previous`— preserved for one render cycle so we can show the diff on
 *               the SAME visit that performs the bump.
 *
 * Schema kept intentionally small — adding more here means the tile has to
 * understand more states. Pin to two timestamps.
 */

const STORAGE_KEY = "espace-devhub:last-seen";
const CHANGE_EVENT = "last-seen:change";
// How long the user has to remain on the dashboard before we update
// `current` to "now". Shorter than this and we treat it as a tab flip.
const SETTLE_MS = 4000;

export const LAST_SEEN_CHANGE_EVENT = CHANGE_EVENT;

export function readLastSeen() {
  if (typeof window === "undefined") return { current: null, previous: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { current: null, previous: null };
    const parsed = JSON.parse(raw);
    return {
      current: typeof parsed?.current === "string" ? parsed.current : null,
      previous: typeof parsed?.previous === "string" ? parsed.previous : null,
    };
  } catch {
    return { current: null, previous: null };
  }
}

function write(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Bump `current` to now, sliding the old `current` into `previous`. No-op
 * when the existing `current` is already within `SETTLE_MS` of now (so we
 * don't churn through tab flips).
 */
export function bumpLastSeen() {
  const { current } = readLastSeen();
  const now = new Date().toISOString();
  if (current) {
    const age = Date.now() - new Date(current).getTime();
    if (age < SETTLE_MS) return; // skip — we just bumped
  }
  write({ current: now, previous: current });
}

export const LAST_SEEN_SETTLE_MS = SETTLE_MS;
