"use client";

/**
 * AI goal-tier verdict cache (Phase 2 + per-window Phase 3).
 *
 * Caches the result of `POST /api/v1/ai/grade-goal-tier` per goal, and
 * optionally per cadence window within that goal. Each cached verdict
 * carries a `criteriaKey` (hash of the tier criteria + numeric ladder), a
 * data `key` (hash of the live reading / prose), and a `gradedDay` (local
 * YYYY-MM-DD). The hook re-grades qualitative goals at most once per day —
 * or immediately when the criteria change (edit / re-analyze) or the user
 * hits "re-grade" (force). localStorage-backed so it survives reloads; reset
 * on auth transition.
 *
 * NOT server-persisted (beyond the durable-cache hydration below): a tier
 * verdict is a cheap derived read of the goal's tiers + current metrics, so
 * a per-device daily cache is enough (mirrors the review-timing cache, not
 * the grading-verdicts collection). The AI call is the expensive part —
 * caching avoids re-spending tokens on every page view.
 *
 * Keying: the whole-goal verdict (the ladder that's always existed) is
 * stored under the bare `goalId`, unchanged — this keeps every pre-existing
 * cache entry and call site working with no migration. A per-window verdict
 * (one cadence window's own tier, e.g. one quarter) is stored under a
 * composite `${goalId}::${periodKey}` key instead. See `tierKey`.
 */

import { toast } from "sonner";
import { fetchWithRateLimitRetry } from "@/lib/rate-limit";
import { startJob, endJob } from "@/lib/jobs-store";

const STORAGE_KEY = "espace-devhub:goal-tiers";
/** Signatures of verdicts already mirrored to the server (see persistDisplayedVerdict). */
const PUSHED_STORAGE_KEY = "espace-devhub:goal-tiers-pushed";

/**
 * Tier grades share ONE small queue: at most GRADE_CONCURRENCY in flight.
 * Timeline and the Evidence board mount a badge per goal, and each used to
 * fire its POST at once — up to 13 simultaneous model calls, the burst
 * that trips provider limits and the per-user limiter together.
 */
const GRADE_CONCURRENCY = 2;
let gradeActive = 0;
const gradeQueue = [];
function runQueued(task) {
  return new Promise((resolve, reject) => {
    gradeQueue.push({ task, resolve, reject });
    pumpGradeQueue();
  });
}
function pumpGradeQueue() {
  while (gradeActive < GRADE_CONCURRENCY && gradeQueue.length > 0) {
    const { task, resolve, reject } = gradeQueue.shift();
    gradeActive += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        gradeActive -= 1;
        pumpGradeQueue();
      });
  }
}
const CHANGE_EVENT = "goal-tiers:change";

/** Sentinel `periodKey` for the whole-goal verdict — mirrors the server's
 *  WHOLE_GOAL_TIER_KEY (apps/api/src/db/types.ts). Duplicated here rather
 *  than imported: the web app doesn't depend on apps/api. */
export const WHOLE_GOAL_TIER_KEY = "__goal__";

/** Storage key for a goal's verdict: the bare goalId for the whole-goal
 *  verdict (any nullish/omitted/sentinel periodKey), or a composite
 *  `goalId::periodKey` for a single cadence window's own verdict. */
function tierKey(goalId, periodKey) {
  return periodKey && periodKey !== WHOLE_GOAL_TIER_KEY
    ? `${goalId}::${periodKey}`
    : goalId;
}

/** { [goalId | `${goalId}::${periodKey}`]: { tier, reasoning, confidence, key, criteriaKey?, gradedDay?, gradedAt? } }
 *  `gradedAt` (ISO) is when the AI actually graded it — display only; the
 *  once-a-day throttle still keys on `gradedDay`. */
let state = {};
let tick = 0;
let loaded = false;
const inflight = new Set();
// One-shot server hydration: seeds the local cache from the durable DB store
// so a fresh device / cleared localStorage doesn't re-grade unchanged goals.
let hydrated = false;
let hydrating = false;
let hydrationPromise = null;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") state = parsed;
  } catch {
    /* ignore corrupt cache */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / disabled — fine, recomputes next load */
  }
}

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeGoalTiers(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getGoalTiersSnapshot() {
  return tick;
}
export function getGoalTiersServerSnapshot() {
  return 0;
}

/** Current cached verdict for a goal (any key), or null. Pass `periodKey`
 *  to read a single cadence window's own verdict instead of the whole-goal
 *  one. */
export function readGoalTier(goalId, periodKey) {
  load();
  if (!goalId) return null;
  return state[tierKey(goalId, periodKey)] || null;
}

/**
 * Grade a goal's tier unless it's already been graded today against the same
 * criteria. Idempotent: skips when the stored verdict is same-criteria +
 * same-day, or a grade is already in flight for the goal. `force` re-grades
 * regardless (the manual "re-grade" button + window-fill path). On a
 * rate-limit / error the prior verdict is left intact (no failure cached).
 */
export async function gradeGoalTier({
  goalId,
  goalTitle,
  tiers,
  currentData,
  key,
  criteriaKey,
  gradedDay,
  aiProvider,
  periodKey,
  force = false,
}) {
  load();
  if (!goalId || !tiers || !key) return;
  const storeKey = tierKey(goalId, periodKey);
  if (!force) {
    const existing = state[storeKey];
    // Already graded today against these exact criteria — the verdict is a
    // pure function of (criteria, data), so re-running the model would just
    // reproduce it. The hook's effect is the primary throttle; this guards the
    // store directly. (The `key` still flows to the server as the durable-cache
    // coordinate, but it no longer gates the CLIENT re-grade — that's what used
    // to churn on every live-reading change.)
    if (
      existing &&
      criteriaKey != null &&
      gradedDay != null &&
      existing.criteriaKey === criteriaKey &&
      existing.gradedDay === gradedDay
    ) {
      return;
    }
  }
  // In-flight guard runs UNCONDITIONALLY (F9 G1.7 / W1): it used to sit
  // inside `if (!force)`, so force calls — the explicit-fill default
  // path — could spawn concurrent duplicate paid grades on a
  // double-click or a double-mounted hook. Only the cache-freshness
  // short-circuit above stays force-bypassed.
  if (inflight.has(storeKey)) return;
  inflight.add(storeKey);
  // Surface the grade in the shell "running jobs" toast. The request already
  // survives navigation (it writes straight into this module store), so this
  // just makes it visible — and keyed per goal (+ window) so the toast can
  // count them.
  startJob(`grading:${storeKey}`, { kind: "grading", label: goalTitle || "" });
  // Failures used to vanish with the running-jobs toast — the user saw
  // "Grading…" disappear and a badge that never changed. Say what happened
  // and offer the same call again (forced, so the freshness guard can't
  // swallow the retry).
  let failure = null;
  const retryArgs = { goalId, goalTitle, tiers, currentData, key, criteriaKey, gradedDay, aiProvider, periodKey };
  try {
    // Whether the CRITERIA really changed since the grade we hold — the
    // server's once-a-day re-grade throttle lets a criteria edit through.
    // Unknown (no local criteriaKey, e.g. a verdict seeded from the server)
    // is NOT a change: that is exactly the fresh-device case the server
    // throttle exists to catch.
    const held = state[storeKey];
    const criteriaChanged = Boolean(
      held && held.criteriaKey && criteriaKey && held.criteriaKey !== criteriaKey,
    );
    const res = await runQueued(() => fetchWithRateLimitRetry(
      "/api/v1/ai/grade-goal-tier",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-ai-provider": aiProvider || "mistral",
        },
        body: JSON.stringify({
          goalTitle: goalTitle || "",
          tiers,
          currentData: currentData || "",
          provider: aiProvider || undefined,
          // Durable-cache coordinates: the server returns a persisted verdict
          // for a matching hash instead of re-calling the model, and persists
          // fresh grades under (goalId, periodKey, tierHash). `force` bypasses it.
          goalId,
          tierHash: key,
          periodKey: periodKey || undefined,
          force: force || undefined,
          criteriaChanged: criteriaChanged || undefined,
          // Lets the server's throttle count "today" in the user's zone.
          tzOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      },
      { provider: "ai" },
    ));
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.verdict?.tier) {
      // F9 G0.1 — remember what was showing a moment ago. Raw-tier
      // bookkeeping only (the capped diff lives in the hook, G0.3);
      // omitted entirely when there was no prior REAL tier (first grade
      // is a landing, not a move — BR-11).
      const prior = state[storeKey];
      const prevTier =
        prior && !prior.awaiting && !prior.pendingSetup && prior.tier &&
        prior.tier !== body.verdict.tier
          ? prior.tier
          : undefined;
      // When the model graded this verdict — the server's stamp (on a cache
      // hit that's the ORIGINAL grade time, not now). A fresh grade from an
      // older API without the field falls back to the local clock; a cache
      // hit without one leaves it unset so the ladder omits "Last graded"
      // rather than claim a time it doesn't know.
      const gradedAt =
        typeof body.gradedAt === "string" && body.gradedAt
          ? body.gradedAt
          : body.cached
            ? null
            : new Date().toISOString();
      // A `throttled` answer is the server's once-a-day rule returning the
      // verdict it already holds for an OLDER data state: keep that state's
      // hash so tomorrow's first view still sees the data as changed.
      const verdictKey =
        body.throttled && typeof body.tierHash === "string" && body.tierHash ? body.tierHash : key;
      state = {
        ...state,
        [storeKey]: {
          ...body.verdict,
          key: verdictKey,
          criteriaKey,
          gradedDay,
          ...(gradedAt ? { gradedAt } : {}),
          ...(prevTier ? { prevTier } : {}),
        },
      };
      persist();
      notify();
    } else {
      failure = body?.error?.message || `The grader answered with HTTP ${res.status}.`;
    }
  } catch (err) {
    /* network / abort — keep any prior verdict */
    failure = err?.message || "Couldn't reach the grader.";
  } finally {
    inflight.delete(storeKey);
    endJob(`grading:${storeKey}`);
  }
  if (failure) {
    toast.error(`Couldn't grade "${goalTitle || "this goal"}"`, {
      id: `grading-failed:${storeKey}`,
      description: failure,
      action: {
        label: "Retry",
        onClick: () => void gradeGoalTier({ ...retryArgs, force: true }),
      },
    });
  }
}

/**
 * Write a locally-computed verdict (a deterministic numeric grade, or the
 * "awaiting data" state) WITHOUT an API call — same cache shape + persistence
 * as the AI path. Idempotent: no-ops when the stored verdict for this key is
 * already equal, so callers can safely invoke it from a render effect without
 * looping.
 */
export function setGoalTierVerdict(goalId, verdict, key, criteriaKey, periodKey) {
  load();
  if (!goalId || !verdict || !key) return;
  const storeKey = tierKey(goalId, periodKey);
  const existing = state[storeKey];
  if (
    existing &&
    existing.key === key &&
    existing.criteriaKey === criteriaKey &&
    existing.tier === verdict.tier &&
    Boolean(existing.awaiting) === Boolean(verdict.awaiting)
  ) {
    return; // already current — avoid a redundant notify/re-render loop
  }
  // Stamp criteriaKey (so qualitative "awaiting" verdicts validate on the same
  // basis the hook reads) but NOT gradedDay — a deterministic numeric grade or
  // an "awaiting" placeholder must never count as the day's AI grade, or the
  // first real grade of the day would be throttled away.
  // F9 G0.1: carry the prior REAL tier forward as prevTier (omitted when
  // there wasn't one, or when the tier didn't change).
  const priorTier =
    existing && !existing.awaiting && !existing.pendingSetup && existing.tier &&
    existing.tier !== verdict.tier
      ? existing.tier
      : undefined;
  state = {
    ...state,
    [storeKey]: {
      ...verdict,
      key,
      ...(criteriaKey != null ? { criteriaKey } : {}),
      ...(priorTier ? { prevTier: priorTier } : {}),
    },
  };
  persist();
  notify();
}

/**
 * Re-run every effect keyed on the goal-tiers tick without changing any
 * verdict — the fill-feedback debounce (F9 G1.4) calls this after
 * marking fill intent so useGoalTier's grading effect re-evaluates with
 * the intent in hand.
 */
export function pokeGoalTiers() {
  notify();
}

/**
 * Seed the local cache from the durable server store, once per session. Merges
 * ONLY goals we don't already hold locally — a local entry is at least as fresh
 * (it's written on every grade and may carry a newer hash for data changed on
 * this device since the server last saw it). Safe to call from many mounts: the
 * `hydrated`/`hydrating` guards collapse them to a single request, and a 401 /
 * network error leaves it un-hydrated so it retries once auth settles.
 */
export function hydrateGoalTiers() {
  if (hydrated || hydrating || typeof window === "undefined") return hydrationPromise || Promise.resolve();
  hydrating = true;
  hydrationPromise = hydrateGoalTiersOnce();
  return hydrationPromise;
}

async function hydrateGoalTiersOnce() {
  load();
  try {
    const res = await fetch("/api/v1/ai/goal-tier-verdicts", {
      credentials: "include",
    });
    if (res.status === 401) return; // not authed yet — retry on a later mount
    hydrated = true;
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    const rows = Array.isArray(body?.verdicts) ? body.verdicts : [];
    let changed = false;
    let seededPushed = false;
    for (const r of rows) {
      if (!r?.goalId || !r?.tierHash || !r?.verdict) continue;
      const storeKey = tierKey(r.goalId, r.periodKey);
      // A row the client mirrored (numeric / capped) is already what
      // persistDisplayedVerdict would PUT — seed its dedupe so a cold load
      // (new device, cleared storage) doesn't PUT it straight back.
      const mirrored = /^client-(numeric|capped)$/.exec(r.provider || "");
      if (mirrored && r.verdict?.tier) {
        const sig = pushedSignature(r.verdict.tier, r.tierHash, mirrored[1]);
        const pushed = pushedMap();
        if (pushed.get(storeKey) !== sig) {
          pushed.set(storeKey, sig);
          seededPushed = true;
        }
      }
      const gradedAt = typeof r.gradedAt === "string" && r.gradedAt ? r.gradedAt : null;
      const local = state[storeKey];
      if (local) {
        // Keep the local (≥ as fresh) entry — but backfill its grading time
        // when it predates the stamp and describes the same data state.
        if (gradedAt && !local.gradedAt && local.key === r.tierHash && !local.awaiting) {
          state = { ...state, [storeKey]: { ...local, gradedAt } };
          changed = true;
        }
        continue;
      }
      state = {
        ...state,
        [storeKey]: { ...r.verdict, key: r.tierHash, ...(gradedAt ? { gradedAt } : {}) },
      };
      changed = true;
    }
    if (seededPushed) persistPushed();
    if (changed) {
      persist();
      notify();
    }
  } catch {
    /* offline — the POST grade path still consults the server cache */
  } finally {
    hydrating = false;
  }
}

/**
 * Persist the DISPLAYED verdict to the durable server store — the
 * deterministic numeric grade (`source: "numeric"`, which the AI path
 * never persisted, leaving every COUNTER/SCALE/DATE_LOG/tierScale goal
 * invisible on the manager's board and blank on a fresh device) or the
 * consistency-CAPPED tier (`source: "capped"`, written when the cap
 * bites so the stored row can't contradict the badge). Deduped per
 * store key on (tier, data hash, source) so render-effect callers don't
 * re-PUT on every pass; a failed write clears the dedupe so it retries.
 */
//
// The dedupe map is PERSISTED (localStorage, reset with the tier cache on
// auth transitions) and seeded from the server rows on hydration, so a cold
// load no longer re-PUTs every unchanged verdict — it used to, because the
// map lived in memory only (up to 13 PUTs per Evidence / Timeline load).
let pushedRemote = null;
function pushedMap() {
  if (pushedRemote) return pushedRemote;
  pushedRemote = new Map();
  if (typeof window === "undefined") return pushedRemote;
  try {
    const raw = localStorage.getItem(PUSHED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") pushedRemote.set(k, v);
      }
    }
  } catch {
    /* corrupt — start empty */
  }
  return pushedRemote;
}
function persistPushed() {
  if (typeof window === "undefined" || !pushedRemote) return;
  try {
    localStorage.setItem(PUSHED_STORAGE_KEY, JSON.stringify(Object.fromEntries(pushedRemote)));
  } catch {
    /* quota / disabled — the in-memory map still dedupes this session */
  }
}
/** The dedupe signature for one mirrored verdict. Exported for tests. */
export function pushedSignature(tier, key, source) {
  return `${tier}|${key}|${source}`;
}
export function persistDisplayedVerdict(goalId, periodKey, verdict, key, source) {
  if (!goalId || !verdict?.tier || !key || typeof window === "undefined") return;
  const storeKey = tierKey(goalId, periodKey);
  const sig = pushedSignature(verdict.tier, key, source);
  // Mid-hydration: wait for the server rows to seed the dedupe first, or a
  // fresh device PUTs back every verdict the server already holds.
  if (hydrating && hydrationPromise) {
    void hydrationPromise.then(() =>
      persistDisplayedVerdict(goalId, periodKey, verdict, key, source),
    );
    return;
  }
  const pushed = pushedMap();
  if (pushed.get(storeKey) === sig) return;
  pushed.set(storeKey, sig);
  persistPushed();
  void fetch(`/api/v1/ai/goal-tier-verdicts/${encodeURIComponent(goalId)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      periodKey: periodKey || undefined,
      tierHash: key,
      tier: verdict.tier,
      reasoning: verdict.reasoning || "",
      confidence: verdict.confidence || "high",
      source,
    }),
  })
    .then((res) => {
      if (!res.ok) {
        pushed.delete(storeKey);
        persistPushed();
      }
    })
    .catch(() => {
      pushed.delete(storeKey);
      persistPushed();
    });
}

export function resetGoalTiers() {
  state = {};
  loaded = true;
  hydrated = false;
  hydrating = false;
  pushedRemote = new Map();
  notify();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PUSHED_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetGoalTiers);
}
