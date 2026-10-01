"use client";

import { useSyncExternalStore } from "react";
import { providerCache, providersForKey } from "@/lib/provider-cache";
import {
  getRateLimitSnapshot,
  getServerRateLimitSnapshot,
  subscribeRateLimits,
} from "@/lib/rate-limit";
import {
  freshnessVersion,
  isAnyProviderRefreshing,
  isKeyRefreshing,
  keyError,
  subscribeFreshness,
} from "./freshness-store";

/** Data older than this reads as stale even without an error. */
export const STALE_AFTER_MS = 15 * 60_000;

function subscribeAll(fn) {
  const offs = [
    subscribeFreshness(fn),
    providerCache.subscribe(fn),
    subscribeRateLimits(fn),
  ];
  return () => offs.forEach((off) => off());
}

let cacheVersion = 0;
providerCache.subscribe(() => {
  cacheVersion += 1;
});

function versionSnapshot() {
  return `${freshnessVersion()}:${cacheVersion}:${getRateLimitSnapshot().version}`;
}

function serverVersion() {
  return "server";
}

/**
 * Pure derivation (exported for tests). `keys` is one SWR key or a list
 * (a combined tile: the oldest fetchedAt, any refresh, the latest limit
 * and the first error win).
 */
export function computeProviderFreshness(keys, now = Date.now()) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  let fetchedAt = null;
  let persistedOnly = false;
  let isRefreshing = false;
  let error = null;
  let rateLimitedUntil = null;
  const limits = getRateLimitSnapshot().byProvider;
  for (const key of list) {
    const f = providerCache.freshness(key);
    if (f) {
      fetchedAt = fetchedAt === null ? f.fetchedAt : Math.min(fetchedAt, f.fetchedAt);
      if (f.source === "persisted") persistedOnly = true;
    }
    if (isKeyRefreshing(key)) isRefreshing = true;
    if (!error) error = keyError(key);
    for (const provider of providersForKey(key)) {
      const until = limits[provider]?.until;
      if (until && until > now) {
        rateLimitedUntil = rateLimitedUntil === null ? until : Math.max(rateLimitedUntil, until);
      }
    }
  }
  const isStale =
    fetchedAt !== null &&
    (persistedOnly || Boolean(error) || now - fetchedAt > STALE_AFTER_MS);
  return { fetchedAt, isStale, isRefreshing, rateLimitedUntil, error };
}

/**
 * Freshness of a provider SWR key (or several) for "updated 5 min ago" /
 * "rate limited — showing data from 10:42" UI.
 *
 * Returns `{ fetchedAt, isStale, isRefreshing, rateLimitedUntil, error }`:
 *   fetchedAt         epoch ms of the value on screen (persisted or live), or null
 *   isStale           true when that value came from the persisted cache and
 *                     hasn't been re-fetched this session, the last refresh
 *                     failed, or it is older than 15 minutes
 *   isRefreshing      a fetch for the key is in flight
 *   rateLimitedUntil  epoch ms the key's provider is limited until, or null
 *   error             the last fetch's Error (cleared on success), or null.
 *                     `error.rateLimited` marks a limit, not a fault.
 *
 * Re-renders on fetch start/end, cache hydration and rate-limit changes.
 * It does not tick on its own — `isStale`'s 15-minute edge is evaluated
 * whenever the consumer renders.
 */
export function useProviderFreshness(keys) {
  useSyncExternalStore(subscribeAll, versionSnapshot, serverVersion);
  return computeProviderFreshness(keys);
}

/**
 * Provider-level activity for tiles that read through a derived hook
 * (`useDataSource`, the combined feeds) and so don't know their SWR keys:
 *
 *   isRefreshing      any fetch for one of `providers` is in flight
 *   rateLimitedUntil  the latest limit expiry among them, or null
 *   latestFetchedAt   the newest fetch stamp among them, or null
 *
 * `providers` are rate-limit provider ids ("github", "gitlab", "jira",
 * "jenkins"). Same subscriptions as `useProviderFreshness`.
 */
export function useProviderActivity(providers) {
  useSyncExternalStore(subscribeAll, versionSnapshot, serverVersion);
  return computeProviderActivity(providers);
}

/** Pure half of `useProviderActivity` (exported for tests). */
export function computeProviderActivity(providers, now = Date.now()) {
  const list = (Array.isArray(providers) ? providers : [providers]).filter(Boolean);
  const limits = getRateLimitSnapshot().byProvider;
  let rateLimitedUntil = null;
  let latestFetchedAt = null;
  for (const p of list) {
    const until = limits[p]?.until;
    if (until && until > now) {
      rateLimitedUntil = rateLimitedUntil === null ? until : Math.max(rateLimitedUntil, until);
    }
    const at = providerCache.latestFetchedAtFor(p);
    if (Number.isFinite(at)) latestFetchedAt = latestFetchedAt === null ? at : Math.max(latestFetchedAt, at);
  }
  return {
    isRefreshing: isAnyProviderRefreshing(list, providersForKey),
    rateLimitedUntil,
    latestFetchedAt,
  };
}
