"use client";

import { mutate } from "swr";
import { isProviderKey, providersForKey } from "@/lib/provider-cache";
import { rateLimitedUntil } from "@/lib/rate-limit";

/**
 * Force-refetch every cached integration read (F5 — data honesty).
 *
 * Every integration SWR key follows `provider:resource[:…]` (see
 * hooks/*.js), so one predicate revalidates the whole provider layer —
 * merged MRs, Jira tickets, CI builds, review-count hydrations — without
 * touching any non-integration SWR entries a future feature might add.
 *
 * This is deliberately the ONLY mutate call site: before it existed the
 * SWR keys were constant all year (`startOfYearIso()` never changes
 * within a session), so a dashboard left open showed morning data all
 * day with no way to refresh short of a full reload.
 *
 * Returns the SWR promise so callers can await it for a busy state.
 */

/**
 * A key is skipped while every provider it depends on is rate-limited:
 * the fetch would fail fast anyway, and skipping keeps the cached value
 * and its "as of" time untouched. The banner already says when the
 * refresh resumes, and the limit's expiry revalidates failed keys.
 */
function refreshable(key) {
  if (!isProviderKey(key)) return false;
  const providers = providersForKey(key);
  return providers.some((p) => rateLimitedUntil(p) === null);
}

export function refreshIntegrationData() {
  return mutate(refreshable, undefined, { revalidate: true });
}
