"use client";

/**
 * QA Hub config — per-user (per-browser) settings that govern which
 * data sources the QA hub's widgets pull from:
 *
 *   - jiraProjectKey   which Jira project the defect widgets query
 *                       (e.g. ESPQA, QA, BUG). Used by DefectsTile,
 *                       DefectPriorityMixTile, and the JQL the QA
 *                       linkage widget will mine in PR D.
 *   - jenkinsJobName   which Jenkins job powers the automation-health
 *                       tiles (FlakeRateTile, and the default
 *                       selection for BuildPassRateTile).
 *
 * Storage:
 *   localStorage under `eshub:qa:config:v1`. Matches the v0 storage
 *   model — everything personal lives in the browser, nothing
 *   crosses to the API. When we move QA Hub config to backend
 *   persistence (later in the arc) the public hook surface stays
 *   the same; only the read/write helpers swap.
 *
 * Reactivity:
 *   Subscribers re-render on
 *     - other tabs writing the same key (native `storage` event)
 *     - same-tab calls to setConfig (custom `eshub:qa-config-changed`
 *       event, dispatched from writeConfig — the native `storage`
 *       event only fires on OTHER tabs)
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "eshub:qa:config:v1";
const CHANGE_EVENT = "eshub:qa-config-changed";

export const DEFAULT_QA_CONFIG = Object.freeze({
  jiraProjectKey: "ESPQA",
  jenkinsJobName: "qa-sim-target",
});

/** Read the persisted config, falling back to defaults on any error. */
function readConfig() {
  if (typeof window === "undefined") return { ...DEFAULT_QA_CONFIG };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QA_CONFIG };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_QA_CONFIG };
    // Spread defaults first so any newly-added field gets its default
    // value when reading an older shape.
    return { ...DEFAULT_QA_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_QA_CONFIG };
  }
}

/** Persist the config and notify same-tab + cross-tab subscribers. */
function writeConfig(next) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // localStorage throws in private-browsing modes / over-quota.
    // We swallow because the widgets fall back to defaults
    // gracefully — no need to break the form's save action.
  }
}

/**
 * React hook. Returns `{ config, setConfig, resetConfig }`.
 *
 * `setConfig(patch)` does a shallow merge over the persisted object,
 * so callers can update a single field without re-stating the others.
 */
export function useQaHubConfig() {
  // Lazy init so we don't read localStorage during render-on-server.
  const [config, setConfigState] = useState(() => readConfig());

  useEffect(() => {
    const sync = () => setConfigState(readConfig());
    window.addEventListener("storage", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    // SSR may have hydrated with defaults; re-read once on mount
    // in case localStorage has a non-default value.
    sync();
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  const setConfig = useCallback((patch) => {
    const next = { ...readConfig(), ...patch };
    writeConfig(next);
    setConfigState(next);
  }, []);

  const resetConfig = useCallback(() => {
    const next = { ...DEFAULT_QA_CONFIG };
    writeConfig(next);
    setConfigState(next);
  }, []);

  return { config, setConfig, resetConfig };
}
