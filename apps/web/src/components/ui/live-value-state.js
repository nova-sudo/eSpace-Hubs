/**
 * Pure state mapping behind <LiveValue> / <FreshnessNote> — one answer to
 * "what do we show for a provider-backed number right now?", so every tile
 * reads the same way in the same situation.
 *
 * Five situations, and they must never look alike:
 *
 *   skeleton     nothing to show yet and a fetch is (or is about to be) in
 *                flight — a placeholder the size of the number, never "—"
 *                or 0 (a zero is a claim).
 *   value        a number to show. The note says how fresh it is:
 *                  refreshing  → "updating…"
 *                  rate limit  → "as of 10:42 · GitHub rate limit — refreshing at 11:05"
 *                  error       → "as of 10:42 · Couldn't reach GitLab" (+ retry)
 *                  otherwise   → "updated 5 min ago"
 *   limited      rate limited with nothing cached — the reason instead of a number.
 *   error        failed with nothing cached — the reason instead of a number.
 *   empty        everything resolved and there is genuinely nothing: "No activity yet".
 *
 * No React, no DOM: tests run it under node.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "10:42" in the viewer's locale; "" when the stamp is unusable. */
export function clockTime(ms) {
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Full date + time for a tooltip: "1 Oct 2026, 10:42". */
export function absoluteTime(ms) {
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleString([], {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** "just now" · "5 min ago" · "2 h ago" · "yesterday" · "3 days ago". */
export function relativeAgo(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return "";
  const diff = Math.max(0, now - ms);
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.round(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  const days = Math.round(diff / DAY);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * "as of 10:42" for a same-day stamp, "as of 30 Sep, 10:42" otherwise —
 * a bare clock time for yesterday's value would read as today's.
 */
export function asOfLabel(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return "";
  const a = new Date(ms);
  const b = new Date(now);
  const sameDay =
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay) return `as of ${clockTime(ms)}`;
  try {
    const day = a.toLocaleDateString([], { day: "numeric", month: "short" });
    return `as of ${day}, ${clockTime(ms)}`;
  } catch {
    return `as of ${clockTime(ms)}`;
  }
}

/**
 * @typedef {object} LiveInput
 * @property {boolean} [hasValue]        there is a value to render (live or last-known)
 * @property {boolean} [pending]         a fetch is in flight / about to start and nothing is cached
 * @property {boolean} [refreshing]      a fetch is in flight
 * @property {Error|object|null} [error] the last fetch failed (`rateLimited` marks a limit)
 * @property {number|null} [rateLimitedUntil] epoch ms the provider is limited until
 * @property {number|null} [fetchedAt]   epoch ms the value on screen was fetched
 * @property {string} [provider]         display name ("GitHub", "GitLab", "Jira", "your code host")
 * @property {string} [emptyLabel]       copy for the genuinely-empty case
 *
 * @typedef {object} LiveState
 * @property {"skeleton"|"value"|"limited"|"error"|"empty"} kind
 * @property {"quiet"|"updating"|"warn"|"error"|null} tone  the note's tone
 * @property {string|null} note          the one-line freshness / reason copy
 * @property {string|null} title         tooltip (absolute time)
 * @property {boolean} canRetry          show a retry affordance
 * @property {string|null} message       the text that replaces the value (limited / error / empty)
 */

/**
 * @param {LiveInput} input
 * @param {number} [now]
 * @returns {LiveState}
 */
export function resolveLiveState(input = {}, now = Date.now()) {
  const {
    hasValue = false,
    pending = false,
    refreshing = false,
    error = null,
    fetchedAt = null,
    provider = "",
    emptyLabel = "No activity yet",
  } = input;
  const who = provider || "the provider";
  const at = Number.isFinite(fetchedAt) ? fetchedAt : null;
  const title = at ? `Fetched ${absoluteTime(at)}` : null;

  const limitUntil =
    Number.isFinite(input.rateLimitedUntil) && input.rateLimitedUntil > now ? input.rateLimitedUntil : null;
  const limited = Boolean(limitUntil) || Boolean(error?.rateLimited);

  if (limited) {
    const reason = `${provider || "Provider"} rate limit — ${
      limitUntil ? `refreshing at ${clockTime(limitUntil)}` : "retrying shortly"
    }`;
    if (hasValue) {
      return {
        kind: "value",
        tone: "warn",
        note: at ? `${asOfLabel(at, now)} · ${reason}` : reason,
        title,
        canRetry: false,
        message: null,
      };
    }
    return { kind: "limited", tone: "warn", note: null, title: null, canRetry: false, message: reason };
  }

  if (error) {
    const reason = `Couldn't reach ${who}`;
    if (hasValue) {
      return {
        kind: "value",
        tone: "error",
        note: at ? `${asOfLabel(at, now)} · ${reason}` : `Last known · ${reason}`,
        title: [title, error?.message].filter(Boolean).join(" — ") || null,
        canRetry: true,
        message: null,
      };
    }
    return {
      kind: "error",
      tone: "error",
      note: null,
      title: error?.message || null,
      canRetry: true,
      message: reason,
    };
  }

  if (hasValue) {
    if (refreshing) {
      return { kind: "value", tone: "updating", note: "updating…", title, canRetry: false, message: null };
    }
    return {
      kind: "value",
      tone: at ? "quiet" : null,
      note: at ? `updated ${relativeAgo(at, now)}` : null,
      title,
      canRetry: false,
      message: null,
    };
  }

  if (pending || refreshing) {
    return { kind: "skeleton", tone: null, note: null, title: null, canRetry: false, message: null };
  }

  return { kind: "empty", tone: null, note: null, title: null, canRetry: false, message: emptyLabel };
}
