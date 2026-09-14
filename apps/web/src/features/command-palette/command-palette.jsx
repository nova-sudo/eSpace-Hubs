"use client";

/**
 * Cmd+K command palette — single keyboard surface for navigation, actions,
 * and section jumps across the app.
 *
 * Why a palette and not more menu items?
 *   The header has 5 routes. The dashboard has 6 scroll-snap sections. The
 *   analyst has 3 modes. Integrations have 3 providers. Snapshots and
 *   evidence each have one-shot actions. That's ~20 jump targets — too
 *   many for header chips, perfect for a search-and-press surface.
 *
 * Mounting
 *   Mounted once inside `<AppShell>` (above the analyst overlay so it floats
 *   regardless of which slide is active). Listens for ⌘/Ctrl+K and `?`
 *   globally. The palette is route-aware: section-jump items only appear on
 *   the dashboard (their target nodes don't exist elsewhere).
 *
 * Action sources (registered via `commands.js` so adding a new one is one
 * line, not a fork through this file)
 *   - Static nav (routes, "open evidence", etc.)
 *   - Section list (DOM-derived from `[data-section-id]` on `/`)
 *   - AI provider switcher (live from useAiProvider)
 *   - One-shot dashboard actions (snapshot now, export markdown)
 *   - Keyboard shortcut cheatsheet
 *
 * State / accessibility
 *   - `role="dialog"` with focus trap (input auto-focuses on open).
 *   - Esc closes; Enter activates; ↑/↓ navigates highlighted item.
 *   - Returns focus to the previously-focused element on close.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Command, CornerDownLeft, Search } from "lucide-react";
import { Badge, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAiProvider, AI_PROVIDERS } from "@/features/analyst";
import { useSnapshotNow } from "@/features/snapshots";
import { useHubLink } from "@/features/hubs";
import { buildCommands } from "./commands";

const PALETTE_OPEN_EVENT = "command-palette:open";

// Keyboard-key glyphs → lucide icons, so a shortcut hint never renders a
// raw arrow/⌘ character as UI iconography.
const KEY_ICONS = {
  "↑": ArrowUp,
  "↓": ArrowDown,
  "↵": CornerDownLeft,
  "⌘": Command,
};

/** Imperative open from anywhere (e.g. a button). */
export function openCommandPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { provider, setProvider } = useAiProvider();
  const snapshotNow = useSnapshotNow();
  const link = useHubLink();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const previouslyFocused = useRef(null);

  // ── Open/close lifecycle ────────────────────────────────────────────
  const open = useCallback(() => {
    previouslyFocused.current = document.activeElement;
    setQuery("");
    setHighlighted(0);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    // Restore focus to whatever was focused before opening.
    queueMicrotask(() => {
      const el = previouslyFocused.current;
      if (el && typeof el.focus === "function") el.focus();
    });
  }, []);

  // Global keydown — open on ⌘/Ctrl+K (most apps) AND on `?` for the
  // shortcuts cheatsheet (palette opens with the shortcuts category preset).
  useEffect(() => {
    function onKeyDown(e) {
      const isModK =
        e.key === "k" && (e.metaKey || e.ctrlKey);
      // `?` only when not typing into an input/textarea/contenteditable.
      const target = e.target;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const isQuestionMark =
        !typing && (e.key === "?" || (e.key === "/" && e.shiftKey));
      if (isModK || isQuestionMark) {
        e.preventDefault();
        open();
        if (isQuestionMark) {
          // Pre-fill so the shortcuts category is at the top.
          setTimeout(() => setQuery("shortcuts"), 0);
        }
      }
    }
    function onCustom() {
      open();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(PALETTE_OPEN_EVENT, onCustom);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(PALETTE_OPEN_EVENT, onCustom);
    };
  }, [open]);

  // Auto-focus the search input when the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // ── Build command list ──────────────────────────────────────────────
  const commands = useMemo(
    () =>
      buildCommands({
        pathname,
        router,
        provider,
        setProvider,
        snapshotNow,
        link,
      }),
    [pathname, router, provider, setProvider, snapshotNow, link],
  );

  // Filtered + ranked. Ranking is deliberate-and-tiny: fuzzy by token match,
  // section-jump items boosted when on the dashboard.
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const tokens = query.toLowerCase().trim().split(/\s+/);
    return commands.filter((c) => {
      const haystack = `${c.label} ${c.category} ${c.keywords?.join(" ") || ""}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [commands, query]);

  // Group filtered items by category, preserving the first-seen order.
  const grouped = useMemo(() => {
    const groups = new Map();
    filtered.forEach((c) => {
      if (!groups.has(c.category)) groups.set(c.category, []);
      groups.get(c.category).push(c);
    });
    return [...groups.entries()];
  }, [filtered]);

  // Reset highlight when query changes (so it always points at the first
  // visible item).
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // Flat ordered list (matching grouped iteration order) — what ↑/↓ walks.
  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  const activate = useCallback(
    (cmd) => {
      if (!cmd) return;
      try {
        cmd.run();
      } catch (err) {
        toast.error(`Action failed: ${err?.message || err}`);
      }
      close();
    },
    [close],
  );

  // ── Keyboard nav inside the dialog ──────────────────────────────────
  function onInputKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(flat.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activate(flat[highlighted]);
    }
  }

  // Keep the highlighted row scrolled into view when navigating with the
  // keyboard (long lists otherwise leave the highlight off-screen).
  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector(
      `[data-cmd-index="${highlighted}"]`,
    );
    if (node?.scrollIntoView) {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [highlighted]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-fg/40 px-4 pt-[12vh]"
      onClick={(e) => {
        // Click on the backdrop (not the dialog) closes.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="w-full max-w-[640px] overflow-hidden rounded-[var(--radius-xl)] bg-card"
        style={{ boxShadow: "var(--shadow-float)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-2">
          <Search size={17} className="shrink-0 text-muted-fg" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to anywhere · search actions, sections, providers"
            aria-label="Search commands"
            className="h-12 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-dim-fg"
          />
          <Badge tone="neutral" className="font-mono">
            Esc
          </Badge>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {flat.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-muted-fg">
              No matches for “{query}”.
            </div>
          ) : (
            grouped.map(([category, items]) => (
              <div key={category} className="mb-2 last:mb-0">
                <Label className="block px-2 py-1">{category}</Label>
                <ul className="flex flex-col">
                  {items.map((cmd) => {
                    const flatIdx = flat.indexOf(cmd);
                    const isHi = flatIdx === highlighted;
                    return (
                      <li key={cmd.id} data-cmd-index={flatIdx}>
                        <button
                          type="button"
                          onMouseMove={() => setHighlighted(flatIdx)}
                          onClick={() => activate(cmd)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] px-3 py-2.5 text-left transition-colors",
                            isHi ? "bg-card-alt" : "bg-transparent",
                          )}
                        >
                          <span className="flex items-baseline gap-2 truncate">
                            <span className="text-[13.5px] font-semibold text-fg">
                              {cmd.label}
                            </span>
                            {cmd.sub ? (
                              <span className="truncate text-[12px] text-muted-fg">
                                — {cmd.sub}
                              </span>
                            ) : null}
                          </span>
                          {cmd.shortcut ? <ShortcutKeys keys={cmd.shortcut} /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-card-alt px-4 py-2.5 text-[11.5px] text-muted-fg">
          <span className="flex items-center gap-2">
            <ShortcutKeys keys={["↑", "↓"]} /> navigate
            <ShortcutKeys keys={["↵"]} /> select
          </span>
          <span>{flat.length} match{flat.length === 1 ? "" : "es"}</span>
        </div>
      </div>
    </div>
  );
}

function ShortcutKeys({ keys }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => {
        const Icon = KEY_ICONS[k];
        return (
          <Badge key={i} tone="neutral" className="px-1.5 py-0.5 font-mono">
            {Icon ? <Icon size={11} /> : k}
          </Badge>
        );
      })}
    </span>
  );
}
