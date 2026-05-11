"use client";

/**
 * Client-side AI provider preference.
 *
 * Stored in localStorage so the choice survives reloads. All three AI
 * routes (`/api/v1/ai/{chat,classify-goals,grade-pr}`) honor either an
 * `x-ai-provider` header or a `provider` field on the request body —
 * we send both to keep server-side selection bulletproof regardless
 * of fetch flavor.
 *
 * Default is "mistral" (matches what was running before this feature).
 * If the user picks a provider they don't have an API key for, the
 * server returns a 500 with a clear message — handled per-route.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "espace-devhub:ai-provider";
const CHANGE_EVENT = "ai-provider:change";
const DEFAULT_PROVIDER = "mistral";

export const AI_PROVIDERS = Object.freeze([
  { id: "mistral", label: "Mistral", env: "MISTRAL_API_KEY" },
  { id: "glm", label: "GLM (Z.ai)", env: "GLM_API_KEY" },
  { id: "openrouter", label: "OpenRouter", env: "OPENROUTER_API_KEY" },
]);

function readProvider() {
  if (typeof window === "undefined") return DEFAULT_PROVIDER;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && AI_PROVIDERS.some((p) => p.id === v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_PROVIDER;
}

export function setAiProvider(id) {
  if (typeof window === "undefined") return;
  if (!AI_PROVIDERS.some((p) => p.id === id)) return;
  localStorage.setItem(STORAGE_KEY, id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
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
    subscribe,
    readProvider,
    () => DEFAULT_PROVIDER,
  );
  const setProvider = useCallback((id) => setAiProvider(id), []);
  return {
    provider,
    setProvider,
    aiHeaders: { "x-ai-provider": provider },
    withAiProvider: (body) => ({ provider, ...(body || {}) }),
  };
}

/**
 * Non-React reader. Some callers (e.g. the grading orchestrator's
 * concurrent fetch loop) use this synchronously inside async fns.
 */
export function getAiProvider() {
  return readProvider();
}
