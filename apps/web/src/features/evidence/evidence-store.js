/**
 * localStorage-backed evidence store: what the user has starred as
 * "this is what I want in my next review export".
 *
 * Items have shape:
 *   { id, kind: "merged-pr" | "ticket" | "review", ref, title, date, impact? }
 */

const STORAGE_KEY = "espace-devhub:evidence";
const CHANGE_EVENT = "evidence:change";

export function readStarred() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeAll(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function toggleStar(item) {
  const all = readStarred();
  const exists = all.find((x) => x.id === item.id);
  const next = exists ? all.filter((x) => x.id !== item.id) : [...all, item];
  writeAll(next);
}

export function setImpact(id, impact) {
  const all = readStarred();
  const next = all.map((x) => (x.id === id ? { ...x, impact } : x));
  writeAll(next);
}

export const EVIDENCE_CHANGE_EVENT = CHANGE_EVENT;
