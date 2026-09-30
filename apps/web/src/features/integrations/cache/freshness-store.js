/**
 * In-flight + last-error ledger per provider SWR key, so
 * `useProviderFreshness` can answer "is this refreshing?" and "did the
 * last refresh fail?" without every consumer threading SWR state through.
 *
 * Written only by the SWR middleware in `swr-middleware.js`; module-level
 * because SWR dedupes a key's fetch across hook instances — only one
 * instance's fetcher runs, and every consumer needs the answer.
 */

const inflight = new Map(); // key → count
const errors = new Map(); // key → Error
const listeners = new Set();
let version = 0;

function emit() {
  version += 1;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function markFetchStart(key) {
  inflight.set(key, (inflight.get(key) || 0) + 1);
  emit();
}

export function markFetchEnd(key, error = null) {
  const n = (inflight.get(key) || 1) - 1;
  if (n <= 0) inflight.delete(key);
  else inflight.set(key, n);
  if (error) errors.set(key, error);
  else errors.delete(key);
  emit();
}

export function isKeyRefreshing(key) {
  return (inflight.get(key) || 0) > 0;
}

export function keyError(key) {
  return errors.get(key) ?? null;
}

/**
 * True while any fetch for one of `providers` is in flight — for tiles that
 * read through a derived hook and don't know their SWR keys ("updating…").
 * `providersFor` maps a key to its providers (injected to keep this module
 * free of the cache import).
 */
export function isAnyProviderRefreshing(providers, providersFor) {
  if (!providers || providers.length === 0) return false;
  const wanted = new Set(providers);
  for (const [key, n] of inflight) {
    if (n > 0 && providersFor(key).some((p) => wanted.has(p))) return true;
  }
  return false;
}

/** Keys whose last fetch failed (the rate-limit expiry revalidates these). */
export function erroredKeys() {
  return [...errors.keys()];
}

export function resetFreshnessStore() {
  inflight.clear();
  errors.clear();
  emit();
}

export function subscribeFreshness(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function freshnessVersion() {
  return version;
}
