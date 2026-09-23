"use client";

/**
 * Data layer for shared (assigned) goals — SWR reads over
 * /api/v1/assigned-goals plus the mutations. No UI.
 */

import useSWR, { mutate as globalMutate } from "swr";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api-client";

const BASE = "/assigned-goals";

async function fetcher(path) {
  const r = await apiGet(path);
  if (!r.ok) {
    const err = new Error(r.error?.message || "Couldn't load shared goals.");
    err.code = r.error?.code;
    err.status = r.status;
    throw err;
  }
  return r.data;
}

const OPTS = { revalidateOnFocus: true, shouldRetryOnError: false };

/** Goals I created (manager view). */
export function useCreatedAssignedGoals({ includeArchived = false } = {}) {
  const key = `${BASE}?scope=created${includeArchived ? "&includeArchived=1" : ""}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, OPTS);
  return { goals: data?.goals ?? [], error, loading: isLoading, refresh: mutate };
}

/** Goals shared with me as a viewer. */
export function useSharedWithMe() {
  const { data, error, isLoading, mutate } = useSWR(`${BASE}?scope=viewing`, fetcher, OPTS);
  return { goals: data?.goals ?? [], error, loading: isLoading, refresh: mutate };
}

/** The analytics grid for one goal (creator or viewer). */
export function useAssignedProgress(id) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `${BASE}/${encodeURIComponent(id)}/progress` : null,
    fetcher,
    { ...OPTS, refreshInterval: 60_000 },
  );
  return { progress: data ?? null, error, loading: isLoading, refresh: mutate };
}

/** The values behind one grid cell. `periodKey` null → a one-time plan. */
export function useProgressCell(id, userId, periodKey) {
  const key =
    id && userId
      ? `${BASE}/${encodeURIComponent(id)}/progress/${encodeURIComponent(userId)}/${encodeURIComponent(periodKey ?? "once")}`
      : null;
  const { data, error, isLoading } = useSWR(key, fetcher, OPTS);
  return { cell: data ?? null, error, loading: isLoading };
}

/** Org directory for the pickers. */
export function useOrgPeople() {
  const { data, error, isLoading } = useSWR(`${BASE}/people`, fetcher, {
    ...OPTS,
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
  });
  return { people: data?.people ?? [], error, loading: isLoading };
}

function revalidateAll() {
  return globalMutate((key) => typeof key === "string" && key.startsWith(BASE));
}

function unwrap(r, fallback) {
  if (r.ok) return r.data;
  const err = new Error(r.error?.message || fallback);
  err.code = r.error?.code;
  err.details = r.error?.details;
  throw err;
}

export async function createAssignedGoal(payload) {
  const data = unwrap(await apiPost(BASE, payload), "Couldn't share the goal.");
  void revalidateAll();
  return data.goal;
}

export async function updateAssignedGoal(id, patch) {
  const data = unwrap(
    await apiPatch(`${BASE}/${encodeURIComponent(id)}`, patch),
    "Couldn't save the change.",
  );
  void revalidateAll();
  return data.goal;
}

export async function archiveAssignedGoal(id) {
  const data = unwrap(
    await apiPost(`${BASE}/${encodeURIComponent(id)}/archive`, {}),
    "Couldn't archive the goal.",
  );
  void revalidateAll();
  return data.goal;
}

/** Shared goals assigned to me (incl. archived) — for "Past cycles". */
export function useMyAssignedGoals({ includeArchived = true } = {}) {
  const { data, error, isLoading } = useSWR(
    `${BASE}?scope=assigned${includeArchived ? "&includeArchived=1" : ""}`,
    fetcher,
    { ...OPTS, revalidateOnFocus: false },
  );
  return { goals: data?.goals ?? [], error, loading: isLoading };
}

/** My own period statuses on one shared goal (works after archive). */
export function useMyAssignedProgress(id) {
  const { data, error, isLoading } = useSWR(
    id ? `${BASE}/${encodeURIComponent(id)}/mine` : null,
    fetcher,
    OPTS,
  );
  return { mine: data ?? null, error, loading: isLoading };
}

export async function setAssignedVerdict(id, userId, { tier, note }) {
  const data = unwrap(
    await apiPut(`${BASE}/${encodeURIComponent(id)}/verdicts/${encodeURIComponent(userId)}`, {
      tier,
      note,
    }),
    "Couldn't save the grade.",
  );
  void revalidateAll();
  return data.verdict;
}
