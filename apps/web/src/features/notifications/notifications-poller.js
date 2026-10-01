/**
 * Visibility-aware, shared inbox poller — pure (timers/document injected).
 */

/** Inbox poll cadence while the tab is visible. */
export const NOTIFICATIONS_POLL_MS = 90_000;

/**
 * ONE poller per tab, shared by every mounted `useNotifications` (the bell
 * and the inbox page used to run one interval each), paused while the tab
 * is hidden — a background tab polled every 90s forever. Coming back to the
 * tab refreshes at once (if the last pull is older than a poll period's
 * third) and restarts the cadence.
 *
 * `env` is injectable for tests; the defaults are the browser's.
 */
export function createNotificationsPoller({
  fetchNow,
  intervalMs = NOTIFICATIONS_POLL_MS,
  doc = typeof document !== "undefined" ? document : null,
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = (id) => clearInterval(id),
  now = () => Date.now(),
} = {}) {
  let users = 0;
  let timer = null;
  let lastPull = 0;
  const pull = () => {
    lastPull = now();
    void fetchNow();
  };
  const start = () => {
    if (timer != null) return;
    timer = setIntervalFn(pull, intervalMs);
  };
  const stop = () => {
    if (timer == null) return;
    clearIntervalFn(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (!doc || users === 0) return;
    if (doc.visibilityState === "hidden") {
      stop();
      return;
    }
    if (now() - lastPull > intervalMs / 3) pull();
    start();
  };
  return {
    acquire() {
      users += 1;
      if (users === 1) {
        lastPull = now();
        doc?.addEventListener?.("visibilitychange", onVisibility);
        if (!doc || doc.visibilityState !== "hidden") start();
      }
    },
    release() {
      users = Math.max(0, users - 1);
      if (users === 0) {
        stop();
        doc?.removeEventListener?.("visibilitychange", onVisibility);
      }
    },
    /** For tests. */
    get running() {
      return timer != null;
    },
  };
}

