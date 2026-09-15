/**
 * Admin hub — the pure layer. Status vocabulary, slot labels, date
 * formatting, email parsing and the client-side copy of the hub-config
 * merge rules. No React, no I/O, no JSX: everything here is a function
 * of its arguments so the pages stay presentational.
 *
 * The hub-config merge mirrors `apps/api/src/modules/hubs/merge.ts`
 * exactly. The admin matrix has to reason about hubs that /hubs/me
 * deliberately hides (a hub an override disabled, or one this admin's
 * own roles don't reach), so it merges the shared registry with the
 * raw override rows itself rather than reading the already-merged
 * /hubs/me response — which is also what lets a disabled hub be turned
 * back on.
 */

/**
 * Roles an admin can grant. Pulled from db/types.ts ALL_USER_ROLES
 * rather than the shared capability registry: `member` is a real
 * status-quo role on existing rows even though it grants nothing.
 */
export const ALL_ROLES = ["admin", "dev", "qa", "manager", "hr", "po", "member"];

export const ALL_STATUSES = ["invited", "pending_admin", "active", "disabled"];

export const ALL_ENGAGEMENTS = [
  { value: "espace", label: "eSpace" },
  { value: "crealogix", label: "Crealogix" },
];

/**
 * Human phrasing for the four account states, following Okta's
 * vocabulary — an admin reads "Pending approval", never the raw
 * `pending_admin` enum value.
 */
const STATUS_META = {
  active: { label: "Active", tone: "mint" },
  invited: { label: "Invite sent", tone: "sky" },
  pending_admin: { label: "Pending approval", tone: "lemon" },
  disabled: { label: "Disabled", tone: "peach" },
};

export function statusMeta(status) {
  return (
    STATUS_META[status] ?? {
      label: String(status ?? "Unknown"),
      tone: "neutral",
    }
  );
}

/** The status filter chips, in the order they appear above the table. */
export const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "pending_admin", label: "Pending approval" },
  { value: "disabled", label: "Disabled" },
];

/**
 * Slot id → the name a person would use for that page. Covers every id
 * in the shared registry's PAGE_SLOTS so the matrix and the invite
 * preview never fall back to a raw slot id.
 */
const PAGE_LABELS = {
  dashboard: "Dashboard",
  goals: "Goals",
  goalsv2: "Goals (legacy route)",
  evidence: "Evidence",
  snapshots: "Snapshots",
  reviews: "Reviews",
  settings: "Settings",
  analyst: "Analyst",
  "hub-config": "Hubs & pages",
  users: "Members",
  audit: "Audit log",
  team: "Team",
  employees: "Employees",
  delegated: "Delegated",
  approvals: "Approvals",
  tierpolicies: "Tier policies",
};

export function pageLabel(slot) {
  return PAGE_LABELS[slot] ?? slot;
}

/* ─────────────────────────── dates ─────────────────────────── */

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "2h ago" / "yesterday" / "4mo ago" / "never". */
export function formatRelative(iso) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Whole days between `iso` and now, or null when unparseable. */
export function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/** "waiting 2 days" / "waiting since today". */
export function waitedFor(iso) {
  const d = daysSince(iso);
  if (d === null) return "waiting";
  if (d === 0) return "waiting since today";
  return `waiting ${d} day${d === 1 ? "" : "s"}`;
}

/** Midnight this morning, as an offset-bearing ISO string. */
export function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/* ─────────────────────────── audit ─────────────────────────── */

/**
 * Tint for an audit action badge. Keyed off the dot-namespace so a new
 * verb inherits a sensible colour without a code change: sign-in
 * traffic reads as information, AI and grading verdicts as the lavender
 * the rest of the app uses for judgement, deletions as a warning.
 */
export function actionTone(action) {
  const a = String(action ?? "");
  if (a.startsWith("auth.")) return "sky";
  if (a.includes("verdict") || a.includes("grade")) return "lav";
  if (a.includes("delete") || a.includes("reset") || a.includes("wipe")) return "peach";
  if (a.includes("invite") || a.includes("submit")) return "mint";
  return "neutral";
}

/** "goal/DP-L0-5" — the target as one readable token, or null. */
export function targetLabel(entry) {
  if (!entry?.targetType) return null;
  return entry.targetId
    ? `${entry.targetType}/${truncMiddle(entry.targetId, 18)}`
    : entry.targetType;
}

/**
 * A one-line "what changed" for an audit row: the field names present
 * in the diff, or the target when the action carries no diff.
 */
export function changeSummary(entry) {
  const after = entry?.after;
  if (after && typeof after === "object" && !Array.isArray(after)) {
    const keys = Object.keys(after);
    if (keys.length > 0) return `changed ${keys.slice(0, 4).join(", ")}`;
  }
  return targetLabel(entry) ?? "no details recorded";
}

/* ─────────────────────────── misc ─────────────────────────── */

export function sameArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function truncMiddle(s, max) {
  if (typeof s !== "string" || s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}

export function safeStringify(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Name-or-email substring match, case-insensitive. Empty query matches all. */
export function matchesQuery(user, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return (
    String(user.displayName ?? "").toLowerCase().includes(q) ||
    String(user.email ?? "").toLowerCase().includes(q)
  );
}

/* ─────────────────────── email chip parsing ─────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(s) {
  return EMAIL_RE.test(String(s ?? "").trim());
}

/**
 * Split a comma / space / semicolon / newline separated blob into
 * lowercased address tokens. Returns every token, valid or not — the
 * caller renders the invalid ones so the admin can see what it choked
 * on instead of silently dropping a typo.
 */
export function parseEmails(raw) {
  return String(raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/* ───────────────────── hub-config merge (client) ───────────────────── */

/**
 * Effective `pages` map for one hub. Partial merge with null-removal,
 * matching the server: a slot set to null in the override is removed,
 * a slot with a string value is overridden, anything absent passes
 * through from the registry default.
 */
export function effectivePages(defaultPages, overridePages) {
  const pages = { ...(defaultPages ?? {}) };
  if (overridePages && typeof overridePages === "object") {
    for (const [slot, value] of Object.entries(overridePages)) {
      if (value === null) delete pages[slot];
      else if (typeof value === "string" && value.length > 0) pages[slot] = value;
    }
  }
  return pages;
}

/** An override only hides a hub when it says `enabled: false` outright. */
export function hubEnabled(override) {
  return override?.enabled === false ? false : true;
}

/** Effective integration list — the override REPLACES the default wholesale. */
export function effectiveIntegrations(defaultList, override) {
  return Array.isArray(override?.allowedIntegrations)
    ? override.allowedIntegrations
    : (defaultList ?? []);
}

/**
 * Every slot this hub could expose: the ones it exposes today, plus the
 * ones an override removed (a `null` in the override map proves the
 * registry ships that slot). Used for the matrix, so an unchecked box
 * only ever appears where checking it would actually do something.
 */
export function availableSlots(defaultPages, overridePages) {
  const slots = new Set(Object.keys(defaultPages ?? {}));
  if (overridePages && typeof overridePages === "object") {
    for (const slot of Object.keys(overridePages)) slots.add(slot);
  }
  return slots;
}
