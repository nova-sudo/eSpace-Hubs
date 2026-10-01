/**
 * SWR middleware applied app-wide by `<ProviderCacheConfig>`. For
 * provider keys only (`isProviderKey`) it:
 *
 *  - wraps the fetcher to persist each good result per user with its
 *    `fetchedAt`, record in-flight / last error for
 *    `useProviderFreshness`, and turn a `NOT_MODIFIED` (304) answer into
 *    "reuse the cached copy".
 *
 * Non-provider keys pass straight through untouched. The provider SWR
 * defaults (keepPreviousData, no focus revalidation, …) live in
 * `useSwrIf`, where a hook's own options can still override them —
 * middleware only sees the already-merged config.
 */

import { isProviderKey, providerCache } from "@/lib/provider-cache";
import { isNotModified } from "../api-clients/proxy-fetch";
import { markFetchEnd, markFetchStart } from "./freshness-store";

/**
 * Pure fetcher wrapper (exported for tests). `getCached` returns the data
 * currently held for `key` (SWR cache first, persisted fallback second).
 */
export function wrapProviderFetcher(key, fetcher, { cache = providerCache, getCached } = {}) {
  return async (...args) => {
    markFetchStart(key);
    try {
      const result = await fetcher(...args);
      if (isNotModified(result)) {
        cache.confirm(key);
        markFetchEnd(key, null);
        return getCached ? getCached(key) : undefined;
      }
      void cache.write(key, result, Date.now());
      markFetchEnd(key, null);
      return result;
    } catch (err) {
      markFetchEnd(key, err || new Error("fetch failed"));
      throw err;
    }
  };
}

export function providerCacheMiddleware(useSWRNext) {
  return (key, fetcher, config) => {
    if (!isProviderKey(key) || typeof fetcher !== "function") {
      return useSWRNext(key, fetcher, config);
    }
    providerCache.touch(key);
    const wrapped = wrapProviderFetcher(key, fetcher, {
      getCached: (k) => config?.cache?.get?.(k)?.data ?? config?.fallback?.[k],
    });
    return useSWRNext(key, wrapped, config);
  };
}
