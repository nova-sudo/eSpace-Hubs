"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark toggle. Writes the `espace-theme` localStorage key that the
 * no-flash script in app/layout.jsx reads on first paint, and applies the
 * `data-theme` attribute live so the switch is instant.
 *
 * Dark ("Nothing UI" pure-black) is the default: only an explicit "light"
 * choice paints light; anything else (unset / legacy "system") resolves to
 * dark, matching the no-flash script in app/layout.jsx. Clicking flips to the
 * opposite of whatever is currently *resolved*, so the first click always
 * lands you in the mode the icon promises.
 */
const KEY = "espace-theme";

function applyTheme(mode) {
  // Always pin an explicit attribute so dark is the effective default even
  // when the OS is light — the app is dark-first now, not system-following.
  document.documentElement.setAttribute(
    "data-theme",
    mode === "light" ? "light" : "dark",
  );
}

function resolve(mode) {
  return mode === "light" ? "light" : "dark";
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
    setMode(saved || "dark");
  }, []);

  // Reserve the slot before mount to avoid a layout shift in the header.
  if (mode === null) {
    return <span aria-hidden className="block h-8 w-8" />;
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
    <button
      type="button"
      onClick={onClick}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-sub)] border border-border text-muted-fg transition-colors hover:border-border-strong hover:text-fg"
    >
      {resolved === "dark" ? <MoonGlyph /> : <SunGlyph />}
    </button>
  );
}

function SunGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
