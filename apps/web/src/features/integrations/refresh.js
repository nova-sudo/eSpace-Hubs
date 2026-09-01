"use client";

import { mutate } from "swr";

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
const INTEGRATION_KEY_RE = /^(gitlab|github|gh_actions|jenkins|jira|combined):/;

export function refreshIntegrationData() {
  return mutate(
    (key) => typeof key === "string" && INTEGRATION_KEY_RE.test(key),
    undefined,
    { revalidate: true },
  );
}
