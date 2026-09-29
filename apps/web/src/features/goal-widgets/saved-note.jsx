"use client";

/**
 * "Saved · W40 now 3 / 3" — the short inline confirmation a widget shows
 * after a log lands, so a tap on + or Log visibly did something (R5). One
 * polite live region per widget; the text clears itself after a few seconds.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const HOLD_MS = 4000;

export function useSavedFlash() {
  const [message, setMessage] = useState("");
  const timer = useRef(null);
  const flash = useCallback((text) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), HOLD_MS);
  }, []);
  useEffect(() => () => timer.current && clearTimeout(timer.current), []);
  return [message, flash];
}

export function SavedNote({ message, className }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("min-h-[18px] text-[12px] font-semibold text-muted-fg", className)}
    >
      {message}
    </span>
  );
}
