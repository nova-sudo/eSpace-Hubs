"use client";

/**
 * Header hub-switcher. Renders only when the user has access to
 * more than one hub. Single-hub users see nothing.
 *
 * Click → dropdown of all available hubs → click an item → set the
 * pick in localStorage + router.push to that hub.
 *
 * Visual: a chip in the header that mirrors the active hub's accent.
 * Sits next to the brand mark. Compact by design — the most common
 * action is "I want to stay where I am", so the switcher should
 * feel like a footnote, not a primary nav surface.
 */

import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@radix-ui/react-dropdown-menu";
import { useActiveHub } from "./hub-context.js";
import { useAvailableHubs } from "./use-available-hubs.js";
import { setActivePick, clearActivePick } from "./hub-pick-store.js";
import { cn } from "@/lib/cn";

export function HubSwitcher() {
  const router = useRouter();
  const active = useActiveHub();
  const { hubs, status } = useAvailableHubs();

  // Render nothing when the user has 0 or 1 hubs — the switcher only
  // exists for multi-hub users.
  if (status !== "ready") return null;
  if (!Array.isArray(hubs) || hubs.length <= 1) return null;
  if (!active) return null;

  function pick(hubId) {
    setActivePick(hubId);
    if (hubId !== active.id) {
      router.push(`/${hubId}`);
    }
  }

  function rePick() {
    clearActivePick();
    router.push("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch hub. Active: ${active.label}`}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2.5 py-1 transition-colors hover:opacity-90",
          )}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            borderColor: "var(--border-strong)",
            background: "var(--accent-dim)",
            color: "var(--accent)",
          }}
        >
          <span
            className="grid h-4 w-4 place-items-center rounded-sm font-bold"
            style={{
              background: "var(--accent)",
              color: "var(--accent-on)",
              fontSize: 9,
            }}
          >
            {active.id[0].toUpperCase()}
          </span>
          <span className="uppercase tracking-[0.4px]">{active.label}</span>
          <span style={{ opacity: 0.7 }}>▾</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="z-50 min-w-[240px] rounded-md border p-1 shadow-lg"
        style={{
          background: "var(--card)",
          borderColor: "var(--border-strong)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <DropdownMenuLabel
          className="px-2.5 py-2 uppercase tracking-[0.4px] text-dim-fg"
          style={{ fontSize: 10.5 }}
        >
          Switch hub
        </DropdownMenuLabel>
        {hubs.map((hub) => {
          const isActive = hub.id === active.id;
          return (
            <DropdownMenuItem
              key={hub.id}
              onSelect={(e) => {
                e.preventDefault();
                pick(hub.id);
              }}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-sm px-2.5 py-2 outline-none",
                "hover:bg-accent-dim focus:bg-accent-dim",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="grid h-5 w-5 place-items-center rounded-sm font-bold"
                  style={{
                    background: isActive ? "var(--accent-dim)" : "var(--panel-2)",
                    color: isActive ? "var(--accent)" : "var(--muted-fg)",
                    fontSize: 10,
                  }}
                >
                  {hub.id[0].toUpperCase()}
                </span>
                <div>
                  <div className="text-[12px] font-semibold text-fg">
                    {hub.label}
                  </div>
                  <div
                    className="text-dim-fg"
                    style={{ fontSize: 10 }}
                  >
                    /{hub.id}
                  </div>
                </div>
              </div>
              {isActive ? (
                <span
                  className="uppercase tracking-[0.4px]"
                  style={{ fontSize: 9.5, color: "var(--accent)" }}
                >
                  ● current
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1 h-px bg-border" />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            rePick();
          }}
          className="cursor-pointer rounded-sm px-2.5 py-2 text-[11px] text-muted-fg outline-none hover:bg-accent-dim focus:bg-accent-dim"
        >
          Re-open hub picker
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
