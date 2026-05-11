"use client";

/**
 * Orchestrator hook for the CODE_RUBRIC widget.
 *
 * Lifecycle:
 *   1. Load the user's PRs from Jan 1 of the current year (open + merged,
 *      no drafts) via `githubApi.myPrsSince`.
 *   2. For each PR, check the local verdict cache keyed on
 *      `(prId, rubricHash)`. Cache hit → done for that PR.
 *   3. For cache misses, fetch the PR body + comments via
 *      `githubApi.pullDetails`, then POST to `/api/v1/ai/grade-pr`. The
 *      concurrency cap is wired into the loop, not the endpoint — keeps
 *      us from thrashing the upstream model's rate limits.
 *   4. Verdicts are persisted in `grading-store` as each comes back; the
 *      widget re-renders from the store in the same tick.
 *
 * SSR: safe. Returns empty state server-side; all work gated on `window`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useIntegrations, githubApi } from "@/features/integrations";
import { useGoalContext } from "@/features/goal-context";
import {
  GRADING_CHANGE_EVENT,
  readVerdict,
  saveVerdict,
} from "./grading-store";
import { normalizeRubric, rubricHash } from "./rubric-hash";

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

/**
 * Subscribe to grading-store changes so React re-reads verdicts after a
 * fresh grade persists without us needing to keep the whole verdict table
 * in component state.
 */
function subscribeToStore(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(GRADING_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(GRADING_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getStoreSnapshot() {
  // We don't use the snapshot value directly — it just changes whenever the
  // store changes, which is enough to trigger a re-render + re-read via
  // `readVerdict` in the render body.
  return typeof window !== "undefined"
    ? localStorage.getItem("espace-devhub:grading") || ""
    : "";
}

export function useGradedPrs(spec) {
  const { isConnected } = useIntegrations();
  // Capture the CONNECTION BOOLEAN up front. `isConnected` is a new function
  // reference on every `useIntegrations()` call, so passing it directly into
  // a useEffect dep array creates an infinite fetch loop (the effect fires
  // every render → new fetch → state update → re-render → repeat). Boolean
  // comparison via React's default equality is the correct stable signal.
  const githubConnected = isConnected("github");

  const { answers } = useGoalContext(spec?.goalId);
  const rubric = useMemo(() => resolveRubric(spec, answers), [spec, answers]);
  const hash = useMemo(() => rubricHash(rubric), [rubric]);

  // Subscribe to grading store changes so we re-render when verdicts land.
  // Capture the snapshot value — `verdictsByPr` memo below uses it as a
  // dep so it actually recomputes when a verdict lands. Without that
  // dep the memo keys off (prs, hash) only and returns a stale map
  // forever after the first paint, which is what made graded verdicts
  // only appear after a hard refresh.
  const gradingStoreSnap = useSyncExternalStore(
    subscribeToStore,
    getStoreSnapshot,
    () => "",
  );

  const [prs, setPrs] = useState([]);
  const [listError, setListError] = useState(null);
  const [isListLoading, setIsListLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, running: false });
  const cancelRef = useRef({ aborted: false });

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
    if (!githubConnected) {
      setPrs([]);
      setListError(null);
      setIsListLoading(false);
      return;
    }
    let cancelled = false;
    setIsListLoading(true);
    setListError(null);
    githubApi
      .myPrsSince(startOfYearIso())
      .then((items) => {
        if (cancelled) return;
        setPrs(items.map(normalizeSearchItem).filter(Boolean));
      })
      .catch((err) => {
        if (cancelled) return;
        setListError(err);
        // On error: do NOT retry. The consumer shows the error + a retry
        // button. Leaving `prs` as-is lets any prior successful load keep
        // rendering while the retry is pending.
      })
      .finally(() => {
        if (cancelled) return;
        setIsListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [githubConnected, refreshTick]);

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
  const gradeAll = useCallback(async () => {
    if (!rubric.length || !prs.length) return;
    const pending = prs.filter((pr) => !readVerdict(pr.id, hash));
    if (pending.length === 0) return;

    cancelRef.current = { aborted: false };
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
            const details = await githubApi.pullDetails(
              pr.owner,
              pr.repo,
              pr.number,
            );
            if (token.aborted) return;
            const aiProvider =
              typeof localStorage !== "undefined"
                ? localStorage.getItem("espace-devhub:ai-provider") || "mistral"
                : "mistral";
            const res = await fetch("/api/v1/ai/grade-pr", {
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
                  comments: details.comments,
                },
                rubric,
                provider: aiProvider,
              }),
            });
            if (token.aborted) return;
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              // Persist the failure as a verdict so we don't retry until
              // the rubric changes. Violations carry the error message so
              // the UI can surface it.
              saveVerdict(pr.id, hash, {
                pass: false,
                reasoning: `Grading failed: ${body?.error?.message || body?.error || res.status}`,
                violations: [],
                errored: true,
              });
            } else if (body?.verdict) {
              saveVerdict(pr.id, hash, body.verdict);
            }
          } catch (err) {
            if (token.aborted) return;
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
  }, [prs, rubric, hash]);

  // Cancel any in-flight grading when the hook owner unmounts or the
  // rubric changes — we don't want verdicts for the old hash landing in the
  // store under the new hash.
  useEffect(() => {
    return () => {
      cancelRef.current.aborted = true;
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
    gradeAll,
    refreshList,
    hasGithub: githubConnected,
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
  };
}
