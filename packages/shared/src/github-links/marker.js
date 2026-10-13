/**
 * The correlation key between an eSpace tracker period and a GitHub issue.
 *
 * eSpace creates issues; GitHub owns them afterwards. The ONE thing that has
 * to survive every edit, label change, transfer and re-sync is the key that
 * says which period an issue belongs to — so it lives in the issue body as an
 * HTML comment (invisible on GitHub, untouched by its renderer) rather than
 * in a label (deletable in one click) or a title (editable).
 *
 *   <!-- espace:v1 org=<hex> user=<hex> goal=<goalId> idx=<n> key=<periodKey|once> -->
 *
 * `user=` is mandatory. Every assignee of a shared goal (`asg_<id>`) carries
 * the SAME goalId, so without the user the marker cannot say whose issue this
 * is. `idx=` is the positional period index — what `resolvePeriodContent`
 * keys on — and `key=` is the cadence key at publish time, kept for display
 * and for recovery when a plan is re-keyed.
 *
 * Pure. No IO, no dates, no randomness.
 */

export const MARKER_VERSION = "v1";

/** The label every eSpace-created issue carries, so a repo can be filtered. */
export const ESPACE_LABEL = "espace";

/** GitHub label colour (no leading `#`, as the API wants it). */
export const ESPACE_LABEL_COLOR = "5b3fd9";

const HEX_24 = /^[0-9a-f]{24}$/;
const GOAL_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
const PERIOD_KEY_RE = /^[A-Za-z0-9._:-]{1,80}$/;

export const MARKER_RE =
  /<!--\s*espace:v1\s+org=([0-9a-f]{24})\s+user=([0-9a-f]{24})\s+goal=([A-Za-z0-9._:-]{1,120})\s+idx=(\d{1,3})\s+key=([A-Za-z0-9._:-]{1,80})\s*-->/;

function isHex24(v) {
  return typeof v === "string" && HEX_24.test(v);
}

/**
 * Build the marker line. Throws on any value that could not round-trip
 * through MARKER_RE — a marker that cannot be parsed back is worse than no
 * marker, because the issue would exist with no way to reclaim it.
 */
export function buildMarker({ orgId, userId, goalId, periodIndex, periodKey }) {
  if (!isHex24(orgId)) throw new Error("buildMarker: orgId must be a 24-hex id");
  if (!isHex24(userId)) throw new Error("buildMarker: userId must be a 24-hex id");
  if (typeof goalId !== "string" || !GOAL_ID_RE.test(goalId)) {
    throw new Error("buildMarker: goalId has characters the marker cannot carry");
  }
  if (!Number.isInteger(periodIndex) || periodIndex < 0 || periodIndex > 999) {
    throw new Error("buildMarker: periodIndex must be an integer 0..999");
  }
  const key = periodKey == null || periodKey === "" ? "once" : String(periodKey);
  if (!PERIOD_KEY_RE.test(key)) {
    throw new Error("buildMarker: periodKey has characters the marker cannot carry");
  }
  return `<!-- espace:${MARKER_VERSION} org=${orgId} user=${userId} goal=${goalId} idx=${periodIndex} key=${key} -->`;
}

/**
 * Find the marker in an issue body. Returns the parsed fields or null —
 * never throws, because bodies come from GitHub and may be anything.
 */
export function parseMarker(body) {
  if (typeof body !== "string" || body.length === 0) return null;
  const m = MARKER_RE.exec(body);
  if (!m) return null;
  return {
    orgId: m[1],
    userId: m[2],
    goalId: m[3],
    periodIndex: Number.parseInt(m[4], 10),
    periodKey: m[5] === "once" ? null : m[5],
  };
}

/**
 * The per-goal label: `espace:<code>`, sanitised to what GitHub accepts
 * cleanly and what a human can type in a search box. Falls back to the first
 * 12 characters of the goalId when the code is empty or sanitises to nothing.
 */
export function espaceLabel(goalCode, goalId = "") {
  const raw = typeof goalCode === "string" ? goalCode.trim() : "";
  let clean = raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!clean) {
    clean = String(goalId || "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 12);
  }
  if (!clean) clean = "goal";
  return `${ESPACE_LABEL}:${clean.slice(0, 50 - ESPACE_LABEL.length - 1)}`;
}

// ─── comment markers ─────────────────────────────────────────────────
//
// Comments eSpace posts (a manager's shared note, a tier verdict) carry their
// own marker so a re-sync can tell "ours" from a developer's reply, and so a
// retry never posts the same note twice.

export const COMMENT_KINDS = Object.freeze(["manager_note", "tier_verdict"]);

const COMMENT_MARKER_RE =
  /<!--\s*espace:comment\s+kind=(manager_note|tier_verdict)\s+id=([A-Za-z0-9._:-]{1,80})\s*-->/;

export function buildCommentMarker(kind, sourceId) {
  if (!COMMENT_KINDS.includes(kind)) {
    throw new Error("buildCommentMarker: unknown comment kind");
  }
  if (typeof sourceId !== "string" || !/^[A-Za-z0-9._:-]{1,80}$/.test(sourceId)) {
    throw new Error("buildCommentMarker: sourceId has characters the marker cannot carry");
  }
  return `<!-- espace:comment kind=${kind} id=${sourceId} -->`;
}

export function parseCommentMarker(body) {
  if (typeof body !== "string" || body.length === 0) return null;
  const m = COMMENT_MARKER_RE.exec(body);
  if (!m) return null;
  return { kind: m[1], sourceId: m[2] };
}
