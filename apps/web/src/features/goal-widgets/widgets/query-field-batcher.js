/**
 * Coalesce the auto-field reads of ONE window into ONE request.
 *
 * Every `AutoField` used to POST `/integrations/query-field` on mount — a
 * composed tracker with ten auto fields was ten requests against a
 * 30-per-15-minutes budget, so opening three trackers tripped the limiter
 * and every field read "Couldn't read this yet". Fields that ask in the
 * same tick for the same (goal, window) are now sent together to
 * `/integrations/query-fields`, which counts once.
 *
 * Each caller still gets its own single-route-shaped result
 * (`{ ok, data | error }`), so `AutoField` keeps failing and retrying per
 * field. When the batch route is missing (an older API or companion build:
 * 404) or the batch itself fails for a reason that isn't per-field, the
 * fields fall back to the single route one by one.
 *
 * Pure apart from the injected `post` — unit-testable.
 */

/** Group key for one window of one goal. */
export function windowGroupKey({ goalId, periodKey, periodPath }) {
  return JSON.stringify([
    goalId,
    periodKey ?? null,
    Array.isArray(periodPath) && periodPath.length > 0 ? periodPath : null,
  ]);
}

export function createQueryFieldBatcher({ post, schedule = (fn) => setTimeout(fn, 0) }) {
  let groups = new Map();
  let scheduled = false;

  const single = (req) =>
    post("/integrations/query-field", {
      goalId: req.goalId,
      fieldId: req.fieldId,
      ...(req.periodKey != null ? { periodKey: req.periodKey } : {}),
      ...(Array.isArray(req.periodPath) && req.periodPath.length > 0 ? { periodPath: req.periodPath } : {}),
    });

  const flushGroup = async (reqs) => {
    const first = reqs[0];
    const fieldIds = [...new Set(reqs.map((r) => r.fieldId))];
    if (fieldIds.length === 1) {
      // Nothing to batch — keep the single route (and its bucket).
      const res = await single(first);
      for (const r of reqs) r.resolve(res);
      return;
    }
    const res = await post("/integrations/query-fields", {
      goalId: first.goalId,
      fieldIds,
      ...(first.periodKey != null ? { periodKey: first.periodKey } : {}),
      ...(Array.isArray(first.periodPath) && first.periodPath.length > 0
        ? { periodPath: first.periodPath }
        : {}),
    });
    const results = res?.ok ? res.data?.results : null;
    if (!results || typeof results !== "object") {
      // Limiter / auth / missing tracker apply to the whole window: hand
      // every field the same answer. Only a missing route falls back.
      if (res && !res.ok && res.status !== 404) {
        for (const r of reqs) r.resolve(res);
        return;
      }
      await Promise.all(reqs.map(async (r) => r.resolve(await single(r))));
      return;
    }
    for (const r of reqs) {
      const one = results[r.fieldId];
      if (one && one.ok === false && one.error) {
        r.resolve({ ok: false, status: one.status, error: one.error });
      } else if (one) {
        r.resolve({ ok: true, status: 200, data: one });
      } else {
        r.resolve({
          ok: false,
          status: 500,
          error: { code: "query_failed", message: "No reading came back for this field." },
        });
      }
    }
  };

  const flush = () => {
    scheduled = false;
    const batch = groups;
    groups = new Map();
    for (const reqs of batch.values()) {
      flushGroup(reqs).catch((err) => {
        for (const r of reqs) {
          r.resolve({
            ok: false,
            status: 0,
            error: { code: "network_error", message: err?.message || "Request failed" },
          });
        }
      });
    }
  };

  /** Read one auto field; resolves with the single-route `{ ok, data | error }`. */
  return function queryField({ goalId, fieldId, periodKey, periodPath }) {
    return new Promise((resolve) => {
      const key = windowGroupKey({ goalId, periodKey, periodPath });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ goalId, fieldId, periodKey, periodPath, resolve });
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    });
  };
}
