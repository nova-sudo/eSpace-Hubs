"use client";

/**
 * In-memory "running jobs" registry.
 *
 * Background work the user kicks off — AI goal *analysis* (classification) and
 * achievement-*tier grading* — used to die silently when a page unmounted (the
 * analyst overlay aborted its stream on navigation; grading had no visible
 * signal at all). This module-level store outlives any component, so a job
 * registered here survives page switches, and a shell-level toast can show
 * what's running on every page.
 *
 * Deliberately framework-free (lives in lib/, importable by any feature per the
 * import rules): a plain id→job map + a window event broadcast, mirroring the
 * other stores. The React binding (useSyncExternalStore) lives with its one
 * consumer, the shell JobsToast.
 */

const CHANGE_EVENT = "jobs:change";

/**
 * { [id]: { id, kind, label, startedAt, count } }. kind ∈ "analysis" | "grading".
 *
 * `count` reference-counts concurrent starts of the same id: the same goal can
 * be graded twice at once (a forced re-grade races an in-flight auto-grade —
 * the force path skips the inflight guard), so the job must not disappear until
 * BOTH finish. Each startJob bumps the count; endJob drops it and only removes
 * the entry at zero.
 */
let jobs = {};
let tick = 0;

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Register a running job. Re-starting an already-running id keeps its original
 * startedAt and bumps a reference count (refreshing the label). Returns the id.
 */
export function startJob(id, { kind = "job", label = "" } = {}) {
  if (!id) return id;
  const existing = jobs[id];
  jobs = {
    ...jobs,
    [id]: {
      id,
      kind,
      label,
      startedAt: existing?.startedAt ?? Date.now(),
      count: (existing?.count ?? 0) + 1,
    },
  };
  notify();
  return id;
}

/** Deregister a job. Removes the entry only when its ref count hits zero. */
export function endJob(id) {
  const existing = jobs[id];
  if (!id || !existing) return;
  const count = (existing.count ?? 1) - 1;
  if (count > 0) {
    jobs = { ...jobs, [id]: { ...existing, count } };
  } else {
    const next = { ...jobs };
    delete next[id];
    jobs = next;
  }
  notify();
}

/** Snapshot array of currently-running jobs. */
export function getRunningJobs() {
  return Object.values(jobs);
}

/** Clear every job — on auth transition a new user starts clean. */
export function resetJobs() {
  if (Object.keys(jobs).length === 0) return;
  jobs = {};
  notify();
}

export function subscribeJobs(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function getJobsSnapshot() {
  return tick;
}

export function getJobsServerSnapshot() {
  return 0;
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetJobs);
}
