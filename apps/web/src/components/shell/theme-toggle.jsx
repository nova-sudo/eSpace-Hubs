"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { IconButton } from "@/components/ui";

/**
 * Light/dark toggle. Writes the `espace-theme` localStorage key that the
 * no-flash script in app/layout.jsx reads on first paint, and applies the
 * `data-theme` attribute live so the switch is instant.
 *
 * An unset value ("system", or nothing saved) resolves to the OS
 * preference via `prefers-color-scheme` — this app follows the system by
 * default, it doesn't force dark. Clicking flips to the opposite of
 * whatever is currently *resolved*, so the first click always lands you
 * in the mode the icon promises.
 */
const KEY = "espace-theme";

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolve(mode) {
  if (mode === "light" || mode === "dark") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

function applyTheme(mode) {
  document.documentElement.setAttribute("data-theme", mode);
}

export function ThemeToggle() {
  // `null` until mounted so SSR and the first client render agree (the
  // real value lives in localStorage / the OS, neither known on the server).
  const [mode, setMode] = useState(null);

  useEffect(() => {
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* private mode / blocked storage — fall back to system */
    }
    setMode(saved || "system");
  }, []);

  // Reserve the slot before mount to avoid a layout shift in the header.
  if (mode === null) {
    return <span aria-hidden className="block h-[38px] w-[38px]" />;
  }

  const resolved = resolve(mode);
  const next = resolved === "dark" ? "light" : "dark";

  const onClick = () => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
  };

  return (
    <IconButton label={`Switch to ${next} mode`} onClick={onClick}>
      {resolved === "dark" ? <Moon size={15} /> : <Sun size={15} />}
    </IconButton>
  );
}
