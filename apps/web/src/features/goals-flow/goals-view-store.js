"use client";

/**
 * Which detail view the Goals page is showing — "focus" | "timeline" | "board".
 *
 * Device-local, so it lives in localStorage rather than on the user record
 * (same call the hub pick makes): the choice is about the screen you're at,
 * not about you. Writes broadcast a custom event AND the store re-reads on
 * the browser's own `storage` event, so a second tab follows along — the
 * pattern `api-origin-store` / `prefs-store` already use here.
 *
 * Pure data layer: no React. `use-goals-view.js` is the hook over it.
 */

export const GOALS_VIEW_KEY = "espace-goals-view";
export const GOALS_VIEW_CHANGE_EVENT = "goals-view:change";

export const GOALS_VIEWS = Object.freeze(["focus", "timeline", "board"]);
const DEFAULT_VIEW = "focus";

let state = DEFAULT_VIEW;
let hydrated = false;

function readStored() {
  try {
    const stored = localStorage.getItem(GOALS_VIEW_KEY);
    return GOALS_VIEWS.includes(stored) ? stored : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

function emit() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(GOALS_VIEW_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * The current view. The localStorage read is deferred to the first call so
 * the module is safe to import on the server; `useSyncExternalStore` renders
 * `getGoalsViewServerSnapshot()` during hydration and only then adopts this,
 * which is what keeps the stored choice from tripping a hydration mismatch.
 */
export function getGoalsView() {
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    state = readStored();
  }
  return state;
}

export function getGoalsViewServerSnapshot() {
  return DEFAULT_VIEW;
}

export function setGoalsView(view) {
  if (!GOALS_VIEWS.includes(view)) return;
  hydrated = true;
  if (state === view) return;
  state = view;
  try {
    localStorage.setItem(GOALS_VIEW_KEY, view);
  } catch {
    /* ignore — a private window just loses the persistence, not the page */
  }
  emit();
}

export function subscribeGoalsView(cb) {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  const onStorage = (e) => {
    if (e.key !== null && e.key !== GOALS_VIEW_KEY) return;
    const next = readStored();
    if (next === state) return;
    state = next;
    cb();
  };
  window.addEventListener(GOALS_VIEW_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(GOALS_VIEW_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
