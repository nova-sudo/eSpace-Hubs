"use client";

/**
 * AI provider preference — account-synced via the prefs store (C7).
 *
 * Was localStorage-only; now it rides on the user's server-side prefs
 * (`user.prefs.aiProvider`) so the choice follows the user across
 * devices. This module is a thin, back-compat facade over
 * `@/features/prefs/prefs-store` — the public API (useAiProvider,
 * getAiProvider, setAiProvider, AI_PROVIDERS) is unchanged so existing
 * callers don't move.
 *
 * All three AI routes (`/api/v1/ai/{chat,classify-goals,grade-pr}`)
 * honor either an `x-ai-provider` header or a `provider` body field — we
 * send both to keep server-side selection bulletproof regardless of
 * fetch flavor.
 *
 * Default is "mistral". Picking a provider with no server-side API key
 * surfaces a clear 500 per-route.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  getPrefs,
  getPrefsServerSnapshot,
  setAiProviderPref,
  subscribePrefs,
} from "@/features/prefs";

const DEFAULT_PROVIDER = "mistral";

export const AI_PROVIDERS = Object.freeze([
  { id: "mistral", label: "Mistral", env: "MISTRAL_API_KEY" },
  { id: "glm", label: "GLM (Z.ai)", env: "GLM_API_KEY" },
  { id: "openrouter", label: "OpenRouter", env: "OPENROUTER_API_KEY" },
]);

/** Imperative setter (non-React callers). Persists via the prefs store. */
export function setAiProvider(id) {
  void setAiProviderPref(id);
}

/**
 * React binding. Returns:
 *   - provider: "mistral" | "glm" | "openrouter"
 *   - setProvider(id)
 *   - aiHeaders: header object to spread into fetch() so the server picks
 *     the same provider this hook reports.
 *   - withAiProvider(body): merges `{ provider }` into a JSON body so
 *     server routes see the choice in either header OR body.
 */
export function useAiProvider() {
  const provider = useSyncExternalStore(
    subscribePrefs,
    () => getPrefs().aiProvider,
    getPrefsServerSnapshot,
  );
  const setProvider = useCallback((id) => setAiProviderPref(id), []);
  return {
    provider,
    setProvider,
    aiHeaders: { "x-ai-provider": provider },
    withAiProvider: (body) => ({ provider, ...(body || {}) }),
  };
}

/**
 * Non-React reader. Some callers (the grading / classify fetch loops)
 * read this synchronously inside async fns. Backed by the prefs store's
 * module-level state, hydrated from the session on load.
 */
export function getAiProvider() {
  return getPrefs().aiProvider || DEFAULT_PROVIDER;
}
