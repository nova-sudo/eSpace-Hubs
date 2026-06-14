"use client";

/**
 * Orchestrator hook for the CODE_RUBRIC widget.
 *
 * Lifecycle:
 *   1. On first mount per session, hydrate the verdict cache from the
 *      API via `fetchVerdicts()`. Idempotent — multiple consumers
 *      (dashboard widget, check-in row, SCORECARD components) share
 *      the in-flight promise so only one GET fires.
 *   2. Load the user's PRs from Jan 1 of the current year (open +
 *      merged, no drafts) via `githubApi.myPrsSince`.
 *   3. For each PR, check the hydrated verdict cache keyed on
 *      `(prId, rubricHash)`. Cache hit → done for that PR.
 *   4. For cache misses, fetch the PR body + comments via
 *      `githubApi.pullDetails`, then POST to `/api/v1/ai/grade-pr`. The
 *      concurrency cap is wired into the loop, not the endpoint —
 *      keeps us from thrashing the upstream model's rate limits.
 *   5. Verdicts are persisted via `saveVerdict()` as each comes back
 *      (optimistic in-memory update + background POST). The widget
 *      re-renders from the verdicts-store in the same tick.
 *
 * SSR: safe. Returns empty state server-side; all work gated on
 * `window` inside verdicts-store + githubApi.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useIntegrations, githubApi, gitlabApi } from "@/features/integrations";
import { useGoalContext } from "@/features/goal-context";
import { useSession } from "@/features/auth";
import {
  fetchVerdicts,
  getVerdictsSnapshot,
  getVerdictsServerSnapshot,
  getVerdictsState,
  readVerdict,
  saveVerdict,
  subscribeVerdicts,
} from "./verdicts-store";
import { normalizeRubric, rubricHash } from "./rubric-hash";
import { firstReviewComments } from "./first-review-comments";
import { fetchWithRateLimitRetry, isRateLimitStatus } from "@/lib/rate-limit";
import { getAiProvider } from "@/features/analyst";

/** Concurrency cap for grading calls — honour Mistral rate limits. */
const GRADE_CONCURRENCY = 3;

/**
 * Resolve the rubric array from a goal's context answers.
 *
 * The spec declares which question carries the rubric via its `id`. We
 * prefer the canonical slug "quality-standards" but fall back to the first
 * `kind:"list"` question so this hook keeps working if the AI picked a
 * different slug.
 */
export function resolveRubric(spec, answers) {
  if (!spec?.context?.questions) return [];
  const preferred = spec.context.questions.find(
    (q) => q.id === "quality-standards" || q.id === "rubric",
  );
  const fallback = spec.context.questions.find((q) => q.kind === "list");
  const q = preferred || fallback;
  if (!q) return [];
  return normalizeRubric(answers[q.id]);
}

/** Jan 1 of the current year in ISO yyyy-mm-ddTHH:MM:SSZ form. */
function startOfYearIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
}

// verdicts-store provides `subscribeVerdicts` + `getVerdictsSnapshot` so
// useSyncExternalStore re-renders the hook the moment a verdict lands in
// the in-memory Map (whether from a fresh grade or from the hydration
// pull). The snapshot is a monotonically-incrementing tick — that's all
// React needs to know the verdicts Map changed; the actual lookups happen
// via `readVerdict` in the render body below.

/**
 * @typedef {Object} GradedPrsOptions
 * @property {string[]} [criteriaOverride] — bypass `spec.context.answers`
 *   and use this list of criteria instead. Used by SCORECARD CODE_RUBRIC
 *   components, which carry their criteria on `component.manual.items`
 *   rather than in the goal-context store.
 * @property {boolean} [firstReviewOnly] — override the spec-level flag.
 *   When set, the grader filters PR comments to the first-review
 *   cluster before sending to the AI.
 * @property {string} [scopeKey] — extra tag mixed into the verdict
 *   cache key so two different scopes (e.g. two CODE_RUBRIC components
 *   on one SCORECARD) don't collide. Pass `null`/`undefined` for legacy
 *   un-scoped behaviour.
 * @property {boolean} [enabled] — set to `false` to make the hook
 *   short-circuit (returns empty data). Useful inside SCORECARD widgets
 *   that need a stable count of hook calls but don't always have a
 *   CODE_RUBRIC component to grade.
 */

export function useGradedPrs(spec, options = {}) {
  const { isConnected } = useIntegrations();
  // Capture the CONNECTION BOOLEAN up front. `isConnected` is a new function
  // reference on every `useIntegrations()` call, so passing it directly into
  // a useEffect dep array creates an infinite fetch loop (the effect fires
  // every render → new fetch → state update → re-render → repeat). Boolean
  // comparison via React's default equality is the correct stable signal.
  const githubConnected = isConnected("github");
  const gitlabConnected = isConnected("gitlab");
  // A connected code host (GitHub OR GitLab) is enough to grade — both
  // feed the same provider-neutral list + details + AI-grade pipeline.
  const anyConnected = githubConnected || gitlabConnected;
  // Phase F: hook options. The `enabled` gate runs OUTSIDE the hook
  // body's React calls — every useState/useEffect below still runs
  // unconditionally so hook rules are satisfied, but expensive work
  // (PR list fetch, grade-all loop) checks `enabled` and short-circuits.
  const enabled = options.enabled !== false;
  const scopeKey = options.scopeKey || null;

  const { answers } = useGoalContext(spec?.goalId);
  const rubric = useMemo(() => {
    if (Array.isArray(options.criteriaOverride)) {
      return normalizeRubric(options.criteriaOverride);
    }
    return resolveRubric(spec, answers);
  }, [spec, answers, options.criteriaOverride]);
  // Phase F: when `spec.firstReviewOnly` is set on a CODE_RUBRIC spec,
  // OR when the caller passes `firstReviewOnly` in options (used by
  // SCORECARD CODE_RUBRIC components), grading filters PR comments to
  // the first-review cluster before sending to the AI grader. The
  // hash mixes the flag + the scope key in so verdicts graded with
  // vs. without the scope filter don't collide in the local cache.
  const firstReviewOnly =
    options.firstReviewOnly !== undefined
      ? options.firstReviewOnly === true
      : spec?.firstReviewOnly === true;
  const hash = useMemo(() => {
    const tagBits = [];
    if (scopeKey) tagBits.push(scopeKey);
    if (firstReviewOnly) tagBits.push("fr1");
    return rubricHash(rubric, tagBits.length > 0 ? tagBits.join(":") : null);
  }, [rubric, scopeKey, firstReviewOnly]);

  // Subscribe to verdicts-store changes so we re-render when verdicts
  // land (either freshly graded or hydrated from the API on mount).
  // Capture the snapshot value as a memo dep so verdictsByPr below
  // recomputes whenever the Map changes — without that, the memo keys
  // off (prs, hash) only and returns a stale Map forever after the
  // first paint, which is what made fresh verdicts only appear after
  // a hard refresh in the old localStorage design.
  const gradingStoreSnap = useSyncExternalStore(
    subscribeVerdicts,
    getVerdictsSnapshot,
    getVerdictsServerSnapshot,
  );

  // Hydrate from the API on first mount per session. fetchVerdicts is
  // idempotent (concurrent callers share the in-flight promise) and
  // sets `fetched: true` so subsequent SCORECARD-embedded hooks don't
  // re-fire the GET. The dep on the session user.id makes the pull
  // re-trigger on a fresh login (the auth-transition reset wiped the
  // in-memory Map and `fetched: false` so the gate opens again).
  const { user, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (sessionLoading || !user || !enabled) return;
    const verdictsState = getVerdictsState();
    if (verdictsState.fetched || verdictsState.loading) return;
    void fetchVerdicts();
  }, [user, sessionLoading, enabled]);

  const [prs, setPrs] = useState([]);
  const [listError, setListError] = useState(null);
  const [isListLoading, setIsListLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, running: false });
  // `controller` lets us abort an in-flight rate-limit wait when the hook
  // unmounts or the rubric changes, instead of hanging on a backoff sleep.
  const cancelRef = useRef({ aborted: false, controller: null });

  // Step 1 — load the PR list ONCE per (connected, year) combo.
  // GitHub's search API is aggressively rate-limited (30 req/min/user), and
  // a failed fetch must not trigger a retry loop — we'd burn the quota in
  // seconds. The hook only refetches when github connection flips or the
  // caller explicitly invokes `refreshList()`.
  //
  // Implementation: one useEffect keyed solely on `githubConnected` (a
  // stable boolean). `refreshList` bumps a counter to re-run the effect
  // without needing the effect's dep on a ref (which wouldn't trigger).
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    // Phase F: respect the `enabled` gate. Disabled hooks still run
    // the effect (React rules) but don't fetch.
    if (!anyConnected || !enabled) {
      setPrs([]);
      setListError(null);
      setIsListLoading(false);
      return;
    }
    let cancelled = false;
    setIsListLoading(true);
    setListError(null);
    const since = startOfYearIso();
    // Fetch each connected provider's authored PR/MR list in parallel and
    // union them, tagged with `source` so the grader routes each item to
    // the right details fetch. allSettled so one provider's failure (e.g.
    // an exhausted rate limit) still renders the other's items; the first
    // rejection surfaces as listError for the retry affordance.
    Promise.allSettled([
      githubConnected
        ? githubApi
            .myPrsSince(since)
            .then((items) => items.map(normalizeSearchItem).filter(Boolean))
        : Promise.resolve([]),
      gitlabConnected
        ? gitlabApi
            .myMrsSince(since)
            .then((items) => items.map(normalizeGitlabItem).filter(Boolean))
        : Promise.resolve([]),
    ])
      .then((results) => {
        if (cancelled) return;
        const merged = results
          .filter((r) => r.status === "fulfilled")
          .flatMap((r) => r.value);
        setPrs(merged);
        const firstErr = results.find((r) => r.status === "rejected")?.reason;
        setListError(firstErr || null);
      })
      .finally(() => {
        if (cancelled) return;
        setIsListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [githubConnected, gitlabConnected, refreshTick, enabled]);

  const refreshList = useCallback(() => {
    setRefreshTick((n) => n + 1);
  }, []);

  // Compute verdicts map from the store each render — cheap, keeps the hook
  // stateless w.r.t. verdicts. `gradingStoreSnap` is in the dep array so
  // the memo recomputes the moment a new verdict lands in localStorage
  // (the store dispatches `grading:change` after every saveVerdict).
  const verdictsByPr = useMemo(() => {
    const out = new Map();
    for (const pr of prs) {
      const v = readVerdict(pr.id, hash);
      if (v) out.set(pr.id, v);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prs, hash, gradingStoreSnap]);

  // Step 2 — grade any ungraded PRs when rubric is present.
  //
  // `grade(subset)` runs the AI grader on the PRs you pass it. Filters
  // out PRs that already have a verdict for the current rubric hash so
  // repeat calls are idempotent. Used by:
  //   - `gradeAll`     — grades every PR in the year window
  //   - check-in cells — grade ONLY the PRs merged inside the active
  //                      week so each week's pass-rate is captured on
  //                      its own schedule
  const grade = useCallback(async (subset) => {
    if (!rubric.length || !Array.isArray(subset) || subset.length === 0) return;
    const pending = subset.filter((pr) => !readVerdict(pr.id, hash));
    if (pending.length === 0) return;

    cancelRef.current = { aborted: false, controller: new AbortController() };
    const token = cancelRef.current;

    setProgress({ done: 0, total: pending.length, running: true });

    let cursor = 0;
    let done = 0;
    const workers = Array.from(
      { length: Math.min(GRADE_CONCURRENCY, pending.length) },
      async () => {
        while (!token.aborted) {
          const i = cursor++;
          if (i >= pending.length) return;
          const pr = pending[i];
          try {
            const details =
              pr.source === "gitlab"
                ? await gitlabApi.mrDetails(pr.projectId, pr.iid)
                : await githubApi.pullDetails(pr.owner, pr.repo, pr.number);
            if (token.aborted) return;
            const aiProvider = getAiProvider();
            // Phase F: when firstReviewOnly is set, clip comments
            // to the first-review cluster BEFORE sending. The grader
            // sees only the PR body + the first reviewer comment
            // (plus the author's own pre-review messages), so the
            // rubric judges code quality at first review, not at
            // merge time after iterative fixes.
            const commentsForGrading = firstReviewOnly
              ? firstReviewComments(details.comments, pr.author)
              : details.comments;
            // Rate-limited grade calls wait the upstream-indicated delay
            // and retry transparently (see fetchWithRateLimitRetry). The
            // signal lets a cancel/unmount abort the backoff wait.
            const res = await fetchWithRateLimitRetry(
              "/api/v1/ai/grade-pr",
              {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  "x-ai-provider": aiProvider,
                },
                body: JSON.stringify({
                  pr: {
                    id: pr.id,
                    title: details.title || pr.title,
                    body: details.body,
                    comments: commentsForGrading,
                  },
                  rubric,
                  provider: aiProvider,
                }),
              },
              { provider: "ai", signal: token.controller?.signal },
            );
            if (token.aborted) return;
            const body = await res.json().catch(() => ({}));
            if (res.ok && body?.verdict) {
              saveVerdict(pr.id, hash, body.verdict);
            } else if (isRateLimitStatus(res.status, res.headers)) {
              // Still rate-limited after the retry budget. Leave this PR
              // UNGRADED so a later run picks it up — do NOT poison the
              // cache with an errored verdict the user can't clear
              // without changing the rubric.
            } else if (!res.ok) {
              // Genuine failure (4xx/5xx that isn't a rate limit).
              // Persist it so we don't re-attempt until the rubric
              // changes; violations carry the message for the UI.
              saveVerdict(pr.id, hash, {
                pass: false,
                reasoning: `Grading failed: ${body?.error?.message || body?.error || res.status}`,
                violations: [],
                errored: true,
              });
            }
          } catch (err) {
            if (token.aborted || err?.name === "AbortError") return;
            // A persistent upstream rate limit surfaced from pullDetails
            // (via the proxy) is transient infrastructure, not a
            // gradeable failure — leave the PR ungraded for a later run.
            if (err?.rateLimited) return;
            saveVerdict(pr.id, hash, {
              pass: false,
              reasoning: `Grading error: ${err?.message || err}`,
              violations: [],
              errored: true,
            });
          } finally {
            done += 1;
            if (!token.aborted) {
              setProgress((p) => ({ ...p, done }));
            }
          }
        }
      },
    );

    await Promise.all(workers);
    if (!token.aborted) {
      setProgress({ done: pending.length, total: pending.length, running: false });
    }
  }, [rubric, hash, firstReviewOnly]);

  // Back-compat alias for the dashboard CodeRubricWidget — grades every
  // PR in the year window. New callers prefer `grade(subset)`.
  const gradeAll = useCallback(() => grade(prs), [grade, prs]);

  // Cancel any in-flight grading when the hook owner unmounts or the
  // rubric changes — we don't want verdicts for the old hash landing in the
  // store under the new hash.
  useEffect(() => {
    return () => {
      cancelRef.current.aborted = true;
      // Abort any in-flight rate-limit backoff so we don't sit on a
      // timer after the owner is gone / the rubric changed.
      cancelRef.current.controller?.abort();
    };
  }, [hash]);

  // Summary counters. Failures w/ `errored: true` are excluded from the
  // pass-rate denominator so infrastructure issues don't skew the metric.
  const summary = useMemo(() => {
    const graded = [];
    const errored = [];
    for (const pr of prs) {
      const v = verdictsByPr.get(pr.id);
      if (!v) continue;
      if (v.errored) errored.push(pr);
      else graded.push({ pr, verdict: v });
    }
    const pass = graded.filter((g) => g.verdict.pass).length;
    const total = graded.length;
    return {
      pass,
      total,
      pct: total > 0 ? Math.round((pass / total) * 100) : null,
      errored: errored.length,
      ungraded: prs.length - graded.length - errored.length,
    };
  }, [prs, verdictsByPr]);

  return {
    prs,
    verdictsByPr,
    rubric,
    summary,
    progress,
    isListLoading,
    listError,
    grade,
    gradeAll,
    refreshList,
    // `hasGithub` historically gated the rubric UI on a connected code
    // host; it now means GitHub OR GitLab (grading supports both). The
    // name is kept to avoid a prop-threaded rename across code-rubric-row
    // — a rename + "Connect GitHub or GitLab" copy sweep is the Phase 4
    // follow-up.
    hasGithub: anyConnected,
    hasGitlab: gitlabConnected,
    hash,
    firstReviewOnly,
  };
}

/**
 * Normalize a GitHub search-issues item into the minimal shape the grader
 * needs. Returns null if the item's repo URL doesn't parse (defensive — it
 * always does in practice).
 */
function normalizeSearchItem(item) {
  const repoUrl = item?.repository_url || "";
  // repository_url looks like "https://api.github.com/repos/{owner}/{repo}"
  const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(repoUrl);
  if (!m) return null;
  return {
    id: item.id,
    number: item.number,
    title: item.title || "",
    owner: m[1],
    repo: m[2],
    htmlUrl: item.html_url,
    state: item?.pull_request?.merged_at ? "merged" : item?.state || "open",
    createdAt: item.created_at,
    mergedAt: item?.pull_request?.merged_at || null,
    source: "github",
  };
}

/**
 * Normalize a GitLab authored-MR into the same grading-list shape, tagged
 * `source:"gitlab"` and carrying `{projectId, iid}` so the grader routes
 * it to `gitlabApi.mrDetails`. Mirrors GitHub's `is:open OR is:merged
 * -is:draft` by dropping drafts/WIP and closed-unmerged MRs. Returns null
 * for un-locatable records.
 */
function normalizeGitlabItem(mr) {
  if (!mr || mr.iid == null || mr.project_id == null) return null;
  if (mr.draft || mr.work_in_progress) return null;
  if (mr.state === "closed" && !mr.merged_at) return null;
  return {
    // `gl-` prefix keeps verdict-cache keys from colliding with GitHub's
    // numeric search ids.
    id: `gl-${mr.id ?? `${mr.project_id}-${mr.iid}`}`,
    number: mr.iid,
    title: mr.title || "",
    projectId: mr.project_id,
    iid: mr.iid,
    htmlUrl: mr.web_url,
    state: mr.merged_at ? "merged" : mr.state === "opened" ? "open" : mr.state || "open",
    createdAt: mr.created_at,
    mergedAt: mr.merged_at || null,
    source: "gitlab",
  };
}
