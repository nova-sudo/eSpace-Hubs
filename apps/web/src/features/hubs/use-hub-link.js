"use client";

/**
 * Returns a function that constructs hub-aware URLs.
 *
 *   const link = useHubLink();
 *   link("/goals")             → "/dev/goals"   (or "/qa/goals" under QA)
 *   link("")                   → "/dev"         (the hub's dashboard)
 *   link("/evidence?print=1")  → "/dev/evidence?print=1"
 *
 * Outside an active hub (e.g. a component that accidentally renders
 * at the top level) the helper returns the input unchanged, which
 * routes through the root redirect. Lets a tile component keep
 * working in a no-hub fallback path without conditional logic.
 */

import { useCallback } from "react";
import { useActiveHub } from "./hub-context";

export function useHubLink() {
  const hub = useActiveHub();
  return useCallback(
    (subpath) => {
      const s = String(subpath ?? "");
      if (!hub) return s || "/";
      // Strip a leading slash so we always compose with exactly one.
      const trimmed = s.startsWith("/") ? s.slice(1) : s;
      if (trimmed.length === 0) return `/${hub.id}`;
      return `/${hub.id}/${trimmed}`;
    },
    [hub],
  );
}
