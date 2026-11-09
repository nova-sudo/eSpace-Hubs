/**
 * Where an email link lands. Pure — the redirect component supplies the
 * row (or null when it 404s) and the user's hubs.
 *
 * The path comes from notificationPath() so emails and the inbox never
 * disagree. Paths are hub-less, so pick a hub: one that OWNS the page
 * first (an admin+dev user opening a sign-up approval must land on the
 * admin hub, not whichever hub they used last), then the recent pick,
 * the primary hub, and finally the first hub they have.
 */

import { notificationPath } from "./notification-kinds.js";

/** First path segment → hubs that serve it, in preference order. */
const OWNING_HUBS = {
  users: ["admin"],
  approvals: ["manager", "admin"],
  employees: ["manager"],
  "shared-goals": ["manager"],
  packets: ["manager"],
};

export const EMAIL_SETTINGS = "settings";

/**
 * @param {{ row: object | null | "settings", hubs: { id: string }[], pick?: string | null, primaryHubId?: string | null }} input
 * @returns {string} hub-prefixed path
 */
export function resolveEmailTarget({ row, hubs, pick = null, primaryHubId = null }) {
  const path =
    row === EMAIL_SETTINGS
      ? "/settings?tab=notifications"
      : (row && notificationPath(row)) || "/notifications";
  const ids = (hubs ?? []).map((h) => h.id);
  if (ids.length === 0) return "/";

  const segment = path.replace(/^\//, "").split(/[/?]/)[0];
  const owner = (OWNING_HUBS[segment] ?? []).find((id) => ids.includes(id));
  const hub =
    owner ??
    (pick && ids.includes(pick) ? pick : null) ??
    (primaryHubId && ids.includes(primaryHubId) ? primaryHubId : null) ??
    ids[0];
  return `/${hub}${path}`;
}
