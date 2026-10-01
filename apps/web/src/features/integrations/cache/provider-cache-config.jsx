"use client";

import { useEffect, useMemo, useState } from "react";
import { SWRConfig, mutate } from "swr";
import { useSession } from "@/features/auth";
import { providerCache, providersForKey } from "@/lib/provider-cache";
import { subscribeRateLimits } from "@/lib/rate-limit";
import { RateLimitBanner } from "@/components/shell/rate-limit-banner";
import { providerCacheMiddleware } from "./swr-middleware";
import { erroredKeys, resetFreshnessStore } from "./freshness-store";

const EMPTY = Object.freeze({});

/**
 * The app's one `<SWRConfig>`.
 *
 * - `use`: the provider-cache middleware (persist + freshness ledger for
 *   provider keys only).
 * - `fallback`: the signed-in user's persisted provider results, loaded
 *   from IndexedDB once the user id is known. SWR renders a fallback
 *   value immediately and still revalidates on mount — stale-while-
 *   revalidate. A fallback never overrides fresher cache data, and a
 *   fetch that resolves first simply wins.
 *
 * The default SWR cache is kept (no custom `provider`) so the global
 * `mutate` in use-session (clear on user change) and refresh.js
 * (refresh-all) keep operating on the cache the app actually reads.
 *
 * Also hosts the single rate-limit banner and, when a provider's limit
 * expires, revalidates only the keys whose last fetch failed.
 */
export function ProviderCacheConfig({ children }) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [hydrated, setHydrated] = useState({ userId: null, fallback: EMPTY });

  useEffect(() => {
    let cancelled = false;
    resetFreshnessStore();
    if (!userId) {
      void providerCache.load(null);
      return undefined;
    }
    providerCache.load(userId).then((fallback) => {
      if (!cancelled) setHydrated({ userId, fallback: fallback || EMPTY });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(
    () =>
      subscribeRateLimits((_snapshot, detail) => {
        if (!detail?.cleared || !detail.provider) return;
        const failed = new Set(
          erroredKeys().filter((k) => providersForKey(k).includes(detail.provider)),
        );
        if (failed.size === 0) return;
        void mutate((key) => typeof key === "string" && failed.has(key));
      }),
    [],
  );

  // Never hand one user's fallback to another: only the matching id's
  // hydration is used.
  const fallback = hydrated.userId && hydrated.userId === userId ? hydrated.fallback : EMPTY;
  const value = useMemo(
    () => ({ use: [providerCacheMiddleware], fallback }),
    [fallback],
  );

  return (
    <SWRConfig value={value}>
      {children}
      <RateLimitBanner />
    </SWRConfig>
  );
}

