/**
 * Unified CI/CD "build event" shape + normalisers.
 *
 * Both Jenkins builds and GitHub Actions workflow runs feed into a
 * single `BuildEvent` shape so DEPLOY_FREQUENCY / LEAD_TIME /
 * BUILD_PASS_RATE metric functions don't need a provider switch:
 *
 *   {
 *     ts:         number   // ms since epoch, build start
 *     status:     "success" | "failure" | "running" | "unknown"
 *     durationMs: number   // 0 while running
 *     ref:        string   // branch / tag / "—"
 *     id:         string   // provider-native unique id
 *     name?:      string   // human-readable label
 *     url?:       string   // link out for the row
 *   }
 *
 * Status mapping
 * ──────────────
 *   Jenkins `result`                → status
 *     SUCCESS                       → "success"
 *     FAILURE / UNSTABLE / ABORTED  → "failure"
 *     null (building)               → "running"
 *
 *   GitHub Actions `conclusion`     → status
 *     "success"                     → "success"
 *     "failure" / "cancelled" /
 *     "timed_out" / "action_required"
 *                                   → "failure"
 *     "skipped" / "neutral" / null  → "running" while `status` is
 *                                      "in_progress" / "queued"
 *                                      else "unknown"
 *
 * UNSTABLE counts as failure for our purposes: a partially-broken
 * deploy is still a regression in the user's eyes. SKIPPED runs are
 * not counted (status "unknown") so a workflow that runs only on
 * certain paths doesn't drag the pass-rate down.
 *
 * The normalisers are pure JS — no dates parsed via Date.parse() in
 * hot loops outside this module — so the metric layer can rely on
 * `ev.ts` being a finite ms integer.
 */

/**
 * Normalise one Jenkins build (from `/job/<name>/api/json` builds[])
 * into a BuildEvent. Returns null when the row is unparseable so
 * callers can `.filter(Boolean)` cleanly.
 */
export function normalizeJenkinsBuild(build, jobName) {
  if (!build || typeof build !== "object") return null;
  const ts = Number(build.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const durationMs = Number(build.duration) || 0;
  return {
    ts,
    status: mapJenkinsResult(build.result, build.building),
    durationMs: durationMs > 0 ? durationMs : 0,
    ref: typeof build.displayName === "string" ? build.displayName : "—",
    id: build.number != null ? `jenkins:${jobName}:${build.number}` : `jenkins:${jobName}:${ts}`,
    name: build.displayName || `#${build.number ?? "?"}`,
  };
}

function mapJenkinsResult(result, building) {
  if (building === true) return "running";
  if (result == null) return "running";
  const r = String(result).toUpperCase();
  if (r === "SUCCESS") return "success";
  if (r === "FAILURE" || r === "UNSTABLE" || r === "ABORTED") return "failure";
  return "unknown";
}

/**
 * Normalise one GitHub Actions workflow run (from
 * `/repos/.../actions/runs` workflow_runs[]) into a BuildEvent.
 * Returns null when unparseable.
 */
export function normalizeGithubActionsRun(run) {
  if (!run || typeof run !== "object") return null;
  const start = run.run_started_at || run.created_at;
  const ts = start ? Date.parse(start) : NaN;
  if (!Number.isFinite(ts)) return null;
  // GitHub doesn't ship a `duration_ms` field on workflow runs —
  // derive it from updated_at - run_started_at. For in-progress
  // runs `updated_at` is the latest poll and the value is still
  // useful (ish), but we zero it out so LEAD_TIME doesn't include
  // partially-elapsed runs in the median.
  const end = run.updated_at ? Date.parse(run.updated_at) : NaN;
  const status = mapGithubActionsStatus(run.status, run.conclusion);
  const durationMs =
    status === "running" || !Number.isFinite(end) || end <= ts
      ? 0
      : end - ts;
  return {
    ts,
    status,
    durationMs,
    ref: typeof run.head_branch === "string" && run.head_branch
      ? run.head_branch
      : "—",
    id: `gh_actions:${run.id ?? ts}`,
    name: run.name || run.display_title || `Run ${run.run_number ?? ""}`.trim(),
    url: run.html_url || undefined,
  };
}

function mapGithubActionsStatus(status, conclusion) {
  if (status === "in_progress" || status === "queued" || status === "waiting")
    return "running";
  if (conclusion == null) return "unknown";
  const c = String(conclusion).toLowerCase();
  if (c === "success") return "success";
  if (
    c === "failure" ||
    c === "cancelled" ||
    c === "timed_out" ||
    c === "action_required"
  )
    return "failure";
  return "unknown";
}

// ─── metric functions over BuildEvent[] ─────────────────────────────

/**
 * Count of "success" events in the last `days`. The simplest metric.
 * Returns the count + the trend (8 weekly buckets) so the widget can
 * sparkline it the same way MERGED_COUNT does.
 */
export function deployFrequency(events, days = 30) {
  if (!Array.isArray(events) || events.length === 0) {
    return { count: 0, trend: [] };
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const inWindow = events.filter(
    (e) => e?.ts >= cutoff && e.status === "success",
  );
  return {
    count: inWindow.length,
    trend: weeklyTrend(events.filter((e) => e?.status === "success"), 8),
  };
}

/**
 * Median build duration in MINUTES for successful events in the
 * window. Returns null when no successful builds exist (avoids a
 * misleading 0). Includes a histogram of duration buckets so the
 * widget can render a small distribution chart.
 */
export function leadTimeStats(events, days = 30) {
  if (!Array.isArray(events) || events.length === 0) {
    return { medianMin: null, histogram: [], n: 0 };
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const durations = events
    .filter(
      (e) =>
        e &&
        e.status === "success" &&
        e.ts >= cutoff &&
        Number.isFinite(e.durationMs) &&
        e.durationMs > 0,
    )
    .map((e) => e.durationMs / 60_000);
  if (durations.length === 0) {
    return { medianMin: null, histogram: [], n: 0 };
  }
  return {
    medianMin: medianOf(durations),
    histogram: durationHistogram(durations),
    n: durations.length,
  };
}

/**
 * % of COMPLETED builds in the window that succeeded. "Completed"
 * excludes status === "running" / "unknown" — only success and
 * failure rows count toward the denominator. Returns null when the
 * denominator is 0 so the widget can render "—" instead of "0%".
 */
export function buildPassRate(events, days = 30) {
  if (!Array.isArray(events) || events.length === 0) {
    return { pct: null, pass: 0, fail: 0 };
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let pass = 0;
  let fail = 0;
  for (const e of events) {
    if (!e || e.ts < cutoff) continue;
    if (e.status === "success") pass += 1;
    else if (e.status === "failure") fail += 1;
    // running / unknown excluded from both numerator and denominator
  }
  const total = pass + fail;
  return {
    pct: total > 0 ? Math.round((pass / total) * 100) : null,
    pass,
    fail,
  };
}

// ─── shared helpers ─────────────────────────────────────────────────

function medianOf(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Eight Sun-anchored weekly buckets of event counts, oldest →
 * newest. Same anchoring math as `mergedTrend` so the spark-line is
 * comparable across widgets.
 */
function weeklyTrend(events, weeks) {
  const anchor = new Date();
  anchor.setDate(anchor.getDate() - anchor.getDay());
  anchor.setHours(0, 0, 0, 0);
  const anchorMs = anchor.getTime();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = anchorMs - i * WEEK_MS;
    const end = start + WEEK_MS;
    const n = events.filter((e) => e?.ts >= start && e.ts < end).length;
    buckets.push(n);
  }
  return buckets;
}

/**
 * 6-bucket histogram of duration values in MINUTES:
 *   < 1, 1-5, 5-15, 15-30, 30-60, 60+
 * Picked to span "fast CI" through "long pipelines" without too
 * many empty buckets on either end.
 */
function durationHistogram(durations) {
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const m of durations) {
    if (m < 1) buckets[0] += 1;
    else if (m < 5) buckets[1] += 1;
    else if (m < 15) buckets[2] += 1;
    else if (m < 30) buckets[3] += 1;
    else if (m < 60) buckets[4] += 1;
    else buckets[5] += 1;
  }
  return buckets.map((n, i) => ({
    bin: ["<1m", "1-5m", "5-15m", "15-30m", "30-60m", "60m+"][i],
    n,
  }));
}
