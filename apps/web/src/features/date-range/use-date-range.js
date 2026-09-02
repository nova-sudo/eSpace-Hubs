"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_PRESET, PRESET_IDS, resolveRange } from "./presets";

/**
 * URL-backed date range. State lives in `?range=<preset>` so a selected view
 * is deep-linkable and survives refresh.
 *
 * Returns:
 *   { preset, range, setPreset }
 *
 * `range` is a resolved object (start / end / prevStart / prevEnd / fetchSince).
 */
export function useDateRange() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawPreset = searchParams.get("range");
  const preset = PRESET_IDS.includes(rawPreset) ? rawPreset : DEFAULT_PRESET;

  // `range` recomputes when preset flips; fine for the dashboard cadence.
  const range = useMemo(() => resolveRange(preset), [preset]);

  const setPreset = useCallback(
    (next) => {
      if (!PRESET_IDS.includes(next)) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_PRESET) params.delete("range");
      else params.set("range", next);
      const q = params.toString();
      router.replace(`${pathname}${q ? `?${q}` : ""}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  return { preset, range, setPreset };
}
