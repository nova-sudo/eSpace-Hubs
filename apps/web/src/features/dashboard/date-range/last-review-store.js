/**
 * "When was your last formal performance review?"
 *
 * Backs the `lastreview` date-range preset and the Settings page's
 * "Last review date" input. Account-synced via the prefs store (C7) —
 * was localStorage; now it rides on `user.prefs.lastReviewDate` so the
 * date follows the user across devices.
 *
 * This module is a thin, back-compat facade over the prefs store: the
 * public API (readLastReviewDate / writeLastReviewDate /
 * LAST_REVIEW_CHANGE_EVENT) is unchanged, so presets.js and the account
 * tab keep working without edits.
 *
 * Empty value → the preset falls back to a 90-day rolling window so the
 * chip never produces a confusing empty dashboard for new users.
 */

import {
  getPrefs,
  setLastReviewDatePref,
  LAST_REVIEW_CHANGE_EVENT as PREFS_LAST_REVIEW_CHANGE_EVENT,
} from "@/features/prefs";

export const LAST_REVIEW_CHANGE_EVENT = PREFS_LAST_REVIEW_CHANGE_EVENT;

export function readLastReviewDate() {
  return getPrefs().lastReviewDate || "";
}

export function writeLastReviewDate(iso) {
  void setLastReviewDatePref(iso);
}
