/**
 * Defect / incident math — pure, framework-agnostic.
 *
 * Shared by three surfaces that must agree to the digit:
 *   - the INCIDENT_LOG widget (live tile the user logs into)
 *   - the tier grader's `buildCurrentData` (what the AI judges)
 *   - the Evidence reader (`readIncidentLog`)
 *
 * Lives in lib/ (not a feature) so all three can import it without the
 * goal-widgets ↔ goal-tiers barrel cycle a feature home would create.
 *
 * Entry model (stored in goal-inputs, all fields optional except severity):
 *   Defect entry      { severity:"P1".."P4", downtime?, rca?, action?,
 *                       preventive?: "closed"|"open" }
 *   Deliverables entry { deliverables:number }   // the rate denominator
 *
 * Old entries (`{ severity, downtime, link }`) still read: `link` is treated
 * as a root-cause link, so historical logs keep their documentation.
 */

/** Severity ladder, most→least severe. P1/P2 are "major/critical". */
export const SEVERITY_LEVELS = ["P1", "P2", "P3", "P4"];
export const MAJOR_SEVERITIES = new Set(["P1", "P2"]);

/**
 * Units that mean "budget is a DURATION" (SLA downtime minutes/hours) rather
 * than a COUNT of events (defects/incidents/bugs). Unknown units fall into
 * count mode — the safer default, since "0 / 10 defects" silently summing
 * minutes was the original bug this widget was reported for.
 */
const DURATION_UNITS = new Set([
  "minute", "minutes", "min", "mins", "m",
  "hour", "hours", "hr", "hrs", "h",
  "second", "seconds", "sec", "secs", "s",
]);

export function inferIncidentMode(unit) {
  if (typeof unit !== "string") return "duration";
  return DURATION_UNITS.has(unit.toLowerCase().trim()) ? "duration" : "count";
}

/**
 * Days in a cadence period — used to window "this period" totals so a budget
 * (and a defect rate) resets between quarters. Unknown / non-bucketing periods
 * return 0, meaning "don't window — use all-time".
 */
export function periodToDays(period) {
  if (typeof period !== "string") return 0;
  switch (period.toLowerCase()) {
    case "daily":
    case "day":
      return 1;
    case "weekly":
    case "week":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
    case "month":
      return 30;
    case "quarterly":
    case "quarter":
      return 90;
    case "yearly":
    case "annual":
    case "annually":
    case "year":
      return 365;
    default:
      return 0;
  }
}

/**
 * Filter entries to the current cadence window (ts >= now - periodDays).
 * `now` is injectable so pure callers (the grader) stay deterministic; the
 * widget passes Date.now().
 */
export function filterByPeriod(entries, period, now = Date.now()) {
  const list = Array.isArray(entries) ? entries : [];
  const days = periodToDays(period);
  if (!days) return list;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return list.filter((e) => e && e.ts >= cutoff);
}

function hasText(v) {
  return typeof v === "string" && v.trim() !== "";
}

/** A logged defect: has a severity. (Deliverables entries never do.) */
export function isDefectEntry(e) {
  return !!(e && e.value && typeof e.value === "object" && typeof e.value.severity === "string");
}

/** The rate denominator marker: a numeric `deliverables`, no severity. */
export function isDeliverablesEntry(e) {
  return !!(
    e &&
    e.value &&
    typeof e.value === "object" &&
    e.value.severity == null &&
    Number.isFinite(Number(e.value.deliverables))
  );
}

/**
 * Latest deliverables count among `entries` (last write wins), or null.
 *
 * IMPORTANT: pass the FULL entry list, not a period-windowed one. The rate
 * denominator is a period-level scalar the user maintains, not an event — if it
 * were windowed on the same rolling clock as the defects it divides, it would
 * age out from under a later-logged defect and the rate would silently vanish.
 * Keeping it latest-wins over all entries means it persists until re-entered.
 */
export function latestDeliverables(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let last = null;
  for (const e of list) if (isDeliverablesEntry(e)) last = e;
  return last ? Number(last.value.deliverables) : null;
}

/**
 * Whether an INCIDENT_LOG goal has a real CURRENT-period reading to show/grade.
 * The single source of truth shared by the tier grader's `hasAnyData` gate and
 * the Evidence reader's empty-check, so both agree on when to DEFER (AWAITING /
 * "no data") vs. render a reading — otherwise a period rollover makes the tile,
 * the grader, and Evidence disagree. There's a reading when:
 *   - a defect was logged in the current window, OR
 *   - (count mode) a deliverables denominator is set — a 0% rate is a real
 *     reading, not emptiness, OR
 *   - (duration mode) a downtime budget is configured — "0 within budget" is a
 *     real, passing SLA reading, not emptiness.
 */
export function incidentHasCurrentData(spec, entries, now = Date.now()) {
  const unit = spec?.manual?.unit || "minutes";
  const period = spec?.manual?.target?.period || spec?.manual?.cadence;
  const windowed = filterByPeriod(entries, period, now);
  if (windowed.some(isDefectEntry)) return true;
  if (inferIncidentMode(unit) === "count") return latestDeliverables(entries) != null;
  return spec?.manual?.target?.value != null;
}

/** True when a defect carries a documented root cause (new `rca` or legacy `link`). */
function defectHasRca(v) {
  return hasText(v?.rca) || hasText(v?.link);
}

/**
 * Roll a list of DEFECT entries (already period-filtered + severity-only) into
 * the numbers every surface renders. `bySeverity` preserves P1→P4 order then
 * unknown severities, so the chip strip reads consistently.
 */
export function summarizeDefects(defects) {
  const list = Array.isArray(defects) ? defects : [];
  let totalDowntime = 0;
  let major = 0;
  let withRca = 0;
  let withAction = 0;
  let preventiveClosed = 0;
  let preventiveOpen = 0;
  const severityCount = new Map();

  for (const e of list) {
    const v = e?.value || {};
    const d = Number(v.downtime);
    if (Number.isFinite(d) && d >= 0) totalDowntime += d;
    const sev = typeof v.severity === "string" ? v.severity : "—";
    severityCount.set(sev, (severityCount.get(sev) || 0) + 1);
    if (MAJOR_SEVERITIES.has(sev)) major += 1;
    if (defectHasRca(v)) withRca += 1;
    if (hasText(v.action)) withAction += 1;
    if (v.preventive === "closed") preventiveClosed += 1;
    else if (v.preventive === "open") preventiveOpen += 1;
  }

  const count = list.length;
  const bySeverity = [];
  for (const lvl of SEVERITY_LEVELS) {
    if (severityCount.has(lvl)) bySeverity.push([lvl, severityCount.get(lvl)]);
  }
  for (const [sev, n] of severityCount) {
    if (!SEVERITY_LEVELS.includes(sev)) bySeverity.push([sev, n]);
  }

  return {
    count,
    major,
    minor: count - major,
    totalDowntime,
    mttr: count > 0 ? totalDowntime / count : 0,
    bySeverity,
    withRca,
    withAction,
    // Every escaped defect documented = root cause AND corrective action on all.
    fullyDocumented: count > 0 && withRca === count && withAction === count,
    preventiveClosed,
    preventiveOpen,
  };
}

/**
 * Defect rate as a percentage (defects / deliverables * 100), rounded to one
 * decimal. Null when there's no positive denominator — a rate needs a
 * deliverables count to divide by.
 */
export function defectRatePct(defectCount, deliverables) {
  const n = Number(deliverables);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((defectCount / n) * 1000) / 10;
}
