"use client";

/**
 * Mirror-mode sync helpers for the grading cache.
 *
 * The strategy (plan §3.1, "Mirror" tier):
 *   - Local writes ALWAYS land — synchronous, immediate UI feedback,
 *     same behaviour as the pre-server flow.
 *   - The API is a secondary, fire-and-forget copy. Failures are
 *     absorbed silently (401 = no session, network errors = transient).
 *     The user's local cache stays warm regardless.
 *   - On session establishment, we PULL from the API and merge into
 *     localStorage so a user signing in on a fresh device sees their
 *     historical verdicts.
 *
 * Why fire-and-forget vs. awaiting:
 *   - useGradedPrs runs saveVerdict() from inside an `await` chain
 *     after the upstream grader returns. Adding another `await` here
 *     would gate the UI on network latency twice (grader + mirror)
 *     for no visible benefit.
 *   - The mirror eventually catches up; if it doesn't, the worst case
 *     is the user re-grades the same PR on a different device — one
 *     extra Mistral call, ~3s. Acceptable.
 *
 * Auth detection is implicit: every mirror call sends the session
 * cookie. The API answers 401 if there's no session. Mirror calls
 * keep firing whether the user is logged in or not — the 401s just
 * silently no-op. This is intentional: we don't have to wire a
 * "logged in?" check into every save call site.
 */

import { apiGet, apiPost } from "@/lib/api-client";

const FAIL_LOG_PREFIX = "[grading-sync]";

/** Strip the verdict body to what the API expects. */
function shapeForApi(prId, rubricHash, verdict) {
  return {
    // The API accepts either string or number — send as string so
    // localStorage's numeric prIds and the GitLab-style string ids
    // share one normalised key on the server.
    prId: String(prId),
    rubricHash,
    verdict: {
      pass: !!verdict.pass,
      reasoning:
        typeof verdict.reasoning === "string" ? verdict.reasoning : "",
      violations: Array.isArray(verdict.violations)
        ? verdict.violations.map((v) => (typeof v === "string" ? v : "")).filter(Boolean)
        : [],
    },
  };
}

/**
 * Fire-and-forget write to the API. Returns a promise but callers
 * don't need to await — failures log a warn and do nothing else.
 */
export async function mirrorSaveVerdict(prId, rubricHash, verdict) {
  if (!prId || !rubricHash || !verdict) return;
  const body = shapeForApi(prId, rubricHash, verdict);
  const r = await apiPost("/grading-verdicts", body);
  if (r.ok) return;
  // 401 = no session, that's normal during anonymous browsing.
  if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") return;
  // Anything else: noisy enough to log, not noisy enough to break a save.
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} save failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Mirror the GC pass that the widget calls when the rubric changes.
 * Server-side prune endpoint takes the same `{currentRubricHashByPr}`
 * map the frontend already builds locally.
 */
export async function mirrorPruneUnrelated(currentRubricHashByPr) {
  if (!currentRubricHashByPr || typeof currentRubricHashByPr !== "object") return;
  const r = await apiPost("/grading-verdicts/prune", {
    currentRubricHashByPr,
  });
  if (r.ok) return;
  if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} prune failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * Pull verdicts from the API and merge into localStorage. Called
 * once per session establishment via <GradingSync /> (the lifecycle
 * mount in the root layout).
 *
 * Merge rule: additive — for every (prId, rubricHash) the API knows
 * about, ensure it's in localStorage. Does NOT delete local entries
 * the API doesn't have; those could be from anonymous-session work
 * the user did before logging in.
 *
 * Returns the number of verdicts merged so the caller can decide
 * whether to log / show a toast. Returns 0 on auth failure (no
 * session yet) so the caller treats "not logged in" as a no-op.
 */
export async function pullVerdictsFromApi(saveLocal) {
  if (typeof saveLocal !== "function") return 0;
  const r = await apiGet("/grading-verdicts");
  if (!r.ok) {
    if (r.error?.code === "unauthenticated" || r.error?.code === "totp_required") {
      return 0;
    }
    // eslint-disable-next-line no-console
    console.warn(
      `${FAIL_LOG_PREFIX} pull failed:`,
      r.error?.code,
      r.error?.message,
    );
    return 0;
  }
  const verdicts = Array.isArray(r.data?.verdicts) ? r.data.verdicts : [];
  for (const v of verdicts) {
    // API uses string prId everywhere; localStorage may have
    // mix-type keys from legacy sessions. saveVerdict normalises
    // on the localStorage side too — both converge to the same key.
    saveLocal(v.prId, v.rubricHash, v.verdict);
  }
  return verdicts.length;
}
