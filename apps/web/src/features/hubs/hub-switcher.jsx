"use client";

/**
 * Header hub-switcher. Renders only when the user has access to
 * more than one hub. Single-hub users see nothing.
 *
 * Click → dropdown of all available hubs → click an item → set the
 * pick in localStorage + router.push to that hub.
 *
 * Visual: a compact pill next to the brand mark — the most common
 * action is "I want to stay where I am", so the switcher should
 * feel like a footnote, not a primary nav surface.
 */

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
          className="flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-card px-3.5 py-2 text-[13px] font-semibold text-fg transition-colors hover:bg-card-alt"
        >
          {active.label}
          <ChevronDown size={14} className="text-muted-fg" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="z-50 min-w-[240px] rounded-[var(--radius-xl)] bg-card p-2"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <DropdownMenuLabel className="px-3 py-2 text-[12px] font-semibold text-muted-fg">
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
                "flex cursor-pointer items-center justify-between rounded-[var(--radius-lg)] px-3 py-2.5 outline-none hover:bg-card-alt",
              )}
            >
              <div>
                <div className="text-[13px] font-semibold text-fg">{hub.label}</div>
                <div className="text-[11.5px] text-dim-fg">/{hub.id}</div>
              </div>
              {isActive ? (
                <span className="text-[11.5px] font-bold text-fg">Current</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1 h-px bg-line" />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            rePick();
          }}
          className="cursor-pointer rounded-[var(--radius-lg)] px-3 py-2.5 text-[13px] font-semibold text-muted-fg outline-none hover:bg-card-alt"
        >
          Re-open hub picker
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
