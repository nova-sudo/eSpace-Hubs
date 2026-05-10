/**
 * "When was your last formal performance review?"
 *
 * One ISO date in localStorage. Backs the `lastreview` date-range preset and
 * the Settings page's "Last review date" input.
 *
 * Empty value → preset falls back to a 90-day rolling window so the chip
 * never produces a confusing empty dashboard for new users.
 */

const STORAGE_KEY = "espace-devhub:last-review-date";
const CHANGE_EVENT = "last-review-date:change";

export const LAST_REVIEW_CHANGE_EVENT = CHANGE_EVENT;

export function readLastReviewDate() {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function writeLastReviewDate(iso) {
  if (typeof window === "undefined") return;
  if (!iso) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, iso);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
