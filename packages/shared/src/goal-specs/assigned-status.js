/**
 * Per-period status of ONE person's entries against an assigned goal — the
 * cell model behind the manager's progress grid, the scheduler's due/overdue
 * nudges and the assignee's own "due / late" chip. One pure function so the
 * three surfaces can't disagree about who is late.
 *
 * A window's DEADLINE is its authored period's `dueAt` (end of that UTC day)
 * when the plan names one, otherwise the window's own end — plus the goal's
 * grace period. "Submitted" is the FIRST save into the window (entries carry
 * a server `createdAt`); a composed widget appends one entry per field edit,
 * so the last save is "last edited", and editing a filled window never moves
 * its submission time. Entries written before `createdAt` existed fall back
 * to `ts` (the period time, not the save time) and the cell says `approx`.
 *
 * Statuses:
 *   upcoming  window hasn't started, nothing submitted
 *   open      window started, deadline not passed, nothing submitted
 *   on_time   submitted at or before the deadline
 *   late      submitted after the deadline
 *   missing   deadline passed, nothing submitted
 */

import { buildCycleWindows, composedCycleBounds } from "./windows.js";
import { resolvePeriodContent } from "./types.js";

const DAY = 86_400_000;

function toMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function hasValue(v, kind) {
  if (kind === "checkbox") return v === true;
  return v != null && v !== "";
}

/** Offset (ms) of `timeZone` from UTC at instant `ms` (e.g. Cairo summer = +3h). */
function tzOffsetMs(ms, timeZone) {
  if (!timeZone || timeZone === "UTC") return 0;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
  } catch {
    return 0; // unknown zone → UTC
  }
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant local midnight starts `isoDay` in `timeZone`. */
export function localMidnight(isoDay, timeZone) {
  const utcMidnight = Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(utcMidnight)) return null;
  // Two passes settle DST edges: guess with the offset at UTC midnight, then
  // re-read the offset at the guessed instant.
  const first = utcMidnight - tzOffsetMs(utcMidnight, timeZone);
  return utcMidnight - tzOffsetMs(first, timeZone);
}

/** End (exclusive) of the named day, in `timeZone`, or null. */
function endOfIsoDay(iso, timeZone) {
  if (typeof iso !== "string") return null;
  const start = Date.parse(iso.trim().slice(0, 10));
  if (Number.isNaN(start)) return null;
  const next = new Date(start + DAY).toISOString().slice(0, 10);
  return localMidnight(next, timeZone);
}

/**
 * The fixed period grid for an assigned goal's spec. Bucketing cadences use
 * the shared cycle windows; a one-time / non-bucketing plan is a single
 * window keyed `null` spanning the cycle.
 */
export function assignedWindows(spec, now = Date.now()) {
  const cadence = spec?.composed?.cadence || null;
  const bounds = composedCycleBounds(spec);
  const cycle = buildCycleWindows({ entries: [], cadence, now, ...bounds });
  if (cycle.mode === "pip") {
    const year = new Date(now).getUTCFullYear();
    const start = bounds.cycleStart ?? Date.UTC(year, 0, 1);
    const end = bounds.cycleEnd ?? Date.UTC(year + 1, 0, 1);
    return [{ index: 0, key: null, label: "Once", start, end }];
  }
  return cycle.windows.map((w, index) => ({
    index,
    key: w.key,
    label: w.label,
    start: w.start,
    end: w.end,
  }));
}

function entryInWindow(entry, w) {
  const pk = entry?.value?.periodKey;
  // Nested levels write "<window>::<child>" — they count toward their
  // top-level window. The management half ("mgmt…") is its own track and
  // never counts as the assignee's own submission.
  if (typeof pk === "string" && pk) {
    if (pk.startsWith("mgmt")) return false;
    return w.key != null && (pk === w.key || pk.startsWith(`${w.key}::`));
  }
  if (w.key == null) return true;
  const ts = toMs(entry?.ts);
  return ts != null && ts >= w.start && ts < w.end;
}

/**
 * @param {object} args
 * @param {object} args.spec     the assigned goal's COMPOSED spec
 * @param {Array}  args.entries  ONE assignee's goal_inputs rows for this goal
 * @param {number} [args.now]
 * @param {number} [args.graceMs]
 */
export function periodStatuses({
  spec,
  entries,
  now = Date.now(),
  graceMs = 0,
  timeZone = "UTC",
}) {
  const list = Array.isArray(entries) ? entries : [];
  const grace = Number.isFinite(graceMs) && graceMs > 0 ? graceMs : 0;
  return assignedWindows(spec, now).map((w) => {
    const content = resolvePeriodContent(spec, w.index);
    const fields = Array.isArray(content.fields) ? content.fields : [];
    // Deadlines are "end of the due day" in the goal's timezone (a Cairo
    // assignee filling at 23:30 local on the due day is on time). Window
    // boundaries themselves stay UTC so period keys never shift.
    const windowEndLocal =
      localMidnight(new Date(w.end).toISOString().slice(0, 10), timeZone) ?? w.end;
    const deadline = (endOfIsoDay(content.dueAt, timeZone) ?? windowEndLocal) + grace;

    let submittedAt = null;
    let lastEditedAt = null;
    let latest = null;
    let latestAt = -Infinity;
    let approx = false;
    for (const e of list) {
      if (!entryInWindow(e, w)) continue;
      const created = toMs(e.createdAt);
      const at = created ?? toMs(e.ts);
      if (at == null) continue;
      if (created == null) approx = true;
      if (submittedAt == null || at < submittedAt) submittedAt = at;
      if (lastEditedAt == null || at > lastEditedAt) lastEditedAt = at;
      // "Filled fields" reads the latest TOP-level record of the window —
      // a nested level's record carries its own, different fields.
      const pk = e?.value?.periodKey;
      const topLevel = !(typeof pk === "string" && pk.includes("::"));
      if (topLevel && at >= latestAt) {
        latestAt = at;
        latest = e;
      }
    }

    const values = latest?.value?.values && typeof latest.value.values === "object"
      ? latest.value.values
      : {};
    const filledFields = fields.filter((f) => hasValue(values[f.id], f.kind)).length;

    let status;
    if (submittedAt != null) status = submittedAt <= deadline ? "on_time" : "late";
    else if (now < w.start) status = "upcoming";
    else if (now <= deadline) status = "open";
    else status = "missing";

    return {
      key: w.key,
      index: w.index,
      label: content.authored && content.label ? content.label : w.label,
      start: w.start,
      end: w.end,
      deadline,
      status,
      submittedAt,
      lastEditedAt,
      filledFields,
      totalFields: fields.length,
      approx: submittedAt != null && approx,
    };
  });
}

/** Roll a row of cells into rates. Only windows whose deadline has passed count. */
export function summarizeStatuses(cells) {
  let onTime = 0;
  let late = 0;
  let missing = 0;
  let open = 0;
  let upcoming = 0;
  for (const c of cells || []) {
    if (c.status === "on_time") onTime += 1;
    else if (c.status === "late") late += 1;
    else if (c.status === "missing") missing += 1;
    else if (c.status === "open") open += 1;
    else upcoming += 1;
  }
  const due = onTime + late + missing;
  return {
    onTime,
    late,
    missing,
    open,
    upcoming,
    due,
    completionRate: due ? (onTime + late) / due : null,
    onTimeRate: due ? onTime / due : null,
  };
}
