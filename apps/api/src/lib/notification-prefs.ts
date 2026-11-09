/**
 * Pure notification-preference rules — no DB, so email rendering and its
 * tests can import them without booting the env. lib/notifications.ts
 * re-exports everything here.
 */

import type { NotificationKind } from "../db/types.js";

/** Resolved preferences — the defaults when the user never saved any. */
export interface ResolvedNotificationPrefs {
  muted: NotificationKind[];
  email: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: ResolvedNotificationPrefs = Object.freeze({
  muted: [],
  email: true,
}) as ResolvedNotificationPrefs;

/**
 * Kinds nobody may mute: each is sent only to the person who has to ACT on
 * it (an approver deciding a tracker or a sign-up, a dev whose tracker was
 * sent back, a report or manager told about a reassignment). Muting them
 * would strand work only the recipient can clear — the org-admin queue is
 * the only path for no-manager trackers. Filtered out of stored mutes on
 * write, and ignored on delivery even if an old prefs row lists them.
 */
export const UNMUTABLE_NOTIFICATION_KINDS: readonly NotificationKind[] = Object.freeze([
  "goal_submitted",
  "approval_waiting",
  "approval_queue_stale",
  "goal_changes_requested",
  "user_pending_approval",
  "manager_changed",
] as NotificationKind[]);

/** Pure: may a user mute this kind? */
export function isMutableKind(kind: NotificationKind): boolean {
  return !UNMUTABLE_NOTIFICATION_KINDS.includes(kind);
}

/** Pure: would this kind reach the inbox under these preferences? */
export function kindDelivered(
  prefs: ResolvedNotificationPrefs,
  kind: NotificationKind,
): boolean {
  return !isMutableKind(kind) || !prefs.muted.includes(kind);
}
