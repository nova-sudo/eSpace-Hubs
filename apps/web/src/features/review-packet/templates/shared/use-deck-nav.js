"use client";

import { useCallback, useEffect, useState } from "react";

function typing(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

/**
 * Card index for a deck. Arrow keys on `window` (ignored while typing) plus
 * next/prev/goTo. `direction` is +1 / -1 for the slide that just happened.
 */
export function useDeckNav(count) {
  const [state, setState] = useState({ index: 0, direction: 1 });
  const max = Math.max(count - 1, 0);
  const index = Math.min(state.index, max);

  const goTo = useCallback(
    (to) => setState((s) => {
      const cur = Math.min(s.index, max);
      const n = Math.min(Math.max(to, 0), max);
      return n === cur ? s : { index: n, direction: n > cur ? 1 : -1 };
    }),
    [max],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  return { index, direction: state.direction, next, prev, goTo };
}
