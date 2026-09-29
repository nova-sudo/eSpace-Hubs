/**
 * Per-tab note that THIS tab just signed in with a backup code. The
 * "Move to a new phone" dialog reads it to offer the password-only
 * shortcut; the server is the real judge (it checks the session's
 * `verifiedWithBackupCodeAt` against a 10-minute window) and answers
 * `factor_required` when the shortcut no longer applies.
 *
 * sessionStorage: dies with the tab, never shared across users' tabs.
 * Every access is guarded — storage can throw in private windows.
 */

const KEY = "devhub.auth.backupCodeLoginAt";
export const BACKUP_LOGIN_WINDOW_MS = 10 * 60 * 1000;

export function markBackupCodeLogin(now = Date.now()) {
  try {
    window.sessionStorage.setItem(KEY, String(now));
  } catch {
    /* storage unavailable — the dialog just asks for a code */
  }
}

export function hasRecentBackupCodeLogin(now = Date.now()) {
  try {
    const at = Number(window.sessionStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && now - at <= BACKUP_LOGIN_WINDOW_MS;
  } catch {
    return false;
  }
}

export function clearRecentBackupCodeLogin() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** `?action=` value on Settings → Account that opens the move dialog. */
export const MOVE_2FA_ACTION = "move-2fa";

/** Where the post-sign-in offer sends the user. */
export function moveTwoFactorHref(hub) {
  return `/${hub}/settings?tab=account&action=${MOVE_2FA_ACTION}`;
}
