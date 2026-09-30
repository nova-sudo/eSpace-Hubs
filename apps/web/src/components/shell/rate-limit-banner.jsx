"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  getRateLimitSnapshot,
  getServerRateLimitSnapshot,
  rateLimitProviderLabel,
  subscribeRateLimits,
} from "@/lib/rate-limit";
import { providerCache } from "@/lib/provider-cache";

let cacheTick = 0;
providerCache.subscribe(() => {
  cacheTick += 1;
});
const subscribeCache = (fn) => providerCache.subscribe(fn);
const cacheSnapshot = () => cacheTick;
const serverCacheSnapshot = () => 0;

function clock(ms) {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Banner copy for one limited provider. Exported for tests / stories. */
export function rateLimitMessage(provider, until, dataAt) {
  const who = rateLimitProviderLabel(provider);
  const resume = until ? ` Refreshing again at ${clock(until)}.` : "";
  if (provider === "ai") {
    return `${who} rate limit reached. Grading resumes at ${clock(until)}.`;
  }
  const showing = dataAt ? ` — showing data from ${clock(dataAt)}.` : ".";
  return `${who} rate limit reached${showing}${resume}`;
}

/**
 * The single app-level notice for provider rate limits. One row per
 * limited provider, dismissible; a NEW limit (a later `until`) shows
 * again. Replaces the per-request "waiting Ns" toasts, which stacked
 * during a fan-out. Mounted once by `<ProviderCacheConfig>`.
 */
export function RateLimitBanner() {
  const snapshot = useSyncExternalStore(
    subscribeRateLimits,
    getRateLimitSnapshot,
    getServerRateLimitSnapshot,
  );
  useSyncExternalStore(subscribeCache, cacheSnapshot, serverCacheSnapshot);
  const [dismissed, setDismissed] = useState({});

  const rows = Object.values(snapshot.byProvider).filter(
    (entry) => dismissed[entry.provider] !== entry.until,
  );
  if (rows.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[90] mx-auto flex max-w-xl flex-col gap-2"
    >
      {rows.map((entry) => (
        <div
          key={entry.provider}
          className="pointer-events-auto flex items-center gap-3 rounded-[var(--radius-lg)] bg-lemon px-4 py-2.5 text-[13px] font-semibold text-lemon-ink shadow-[var(--shadow-float)]"
        >
          <p className="min-w-0 flex-1">
            {rateLimitMessage(
              entry.provider,
              entry.until,
              providerCache.latestFetchedAtFor(entry.provider),
            )}
          </p>
          <button
            type="button"
            aria-label={`Dismiss ${rateLimitProviderLabel(entry.provider)} rate limit notice`}
            title="Dismiss"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lemon-ink transition-opacity hover:opacity-70"
            onClick={() =>
              setDismissed((prev) => ({ ...prev, [entry.provider]: entry.until }))
            }
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
