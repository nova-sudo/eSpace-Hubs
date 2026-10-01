import { providerCache } from "@/lib/provider-cache";

/**
 * Per-item entries in the SWR cache, plus a tiny concurrency pool.
 *
 * Why per item: the N+1 fan-outs (PR comment counts, PR/MR details, Jira
 * issue types) used to be ONE SWR entry keyed on the whole id list. Any
 * change to the list — a newly merged PR, a different repo filter on a
 * sibling widget — produced a new key and refetched EVERY item. Merged PRs
 * are effectively immutable, so each item's result is written into the SWR
 * cache under its own long-lived key (`github:pull-count:<id>`, …) and a
 * batch fetcher only asks the provider for items the cache doesn't hold.
 * Going through `useSWRConfig()`'s cache/mutate (not the global `swr`
 * export) means the entries land in whatever cache provider the app
 * configures — including the persisted one — so they survive reloads too.
 */

/**
 * The cached value for `key`, or undefined on a miss. Reads the live SWR
 * cache first, then the SWRConfig `fallback` — where the app's persisted
 * provider cache (`ProviderCacheConfig`) puts last session's results after
 * a reload. Pass `useSWRConfig()`'s `{ cache, fallback }`.
 */
export function readCachedItem({ cache, fallback } = {}, key) {
  if (!key) return undefined;
  try {
    const state = cache?.get?.(key);
    if (state && state.data !== undefined) return state.data;
  } catch {
    /* fall through to the persisted fallback */
  }
  const persisted = fallback && typeof fallback === "object" ? fallback[key] : undefined;
  return persisted !== undefined ? persisted : undefined;
}

/**
 * Write `value` under `key` without triggering a revalidation, and hand it
 * to the persisted provider cache so it survives a reload (the SWR
 * middleware only persists what a mounted hook fetched; per-item entries
 * are written from inside a batch fetcher).
 */
export function writeCachedItem(mutate, key, value) {
  if (!key) return;
  if (typeof mutate === "function") {
    try {
      void mutate(key, value, { revalidate: false, populateCache: true });
    } catch {
      /* cache unavailable — the batch result still carries the value */
    }
  }
  try {
    void providerCache.write(key, value, Date.now());
  } catch {
    /* persistence is an optimisation */
  }
}

/**
 * A FIFO pool that runs at most `size` tasks at once. Module-level pools
 * are shared by every hook instance, so twenty review rows mounting at once
 * still put at most `size` detail fetches on the wire (GitHub's secondary
 * limits punish concurrency, not volume).
 */
export function createPool(size) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < size && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return function run(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      pump();
    });
  };
}
