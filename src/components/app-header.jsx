"use client";

import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";
import { useIntegrations } from "@/hooks/use-integrations";

export function AppHeader() {
  const { connectedProviders } = useIntegrations();
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">eSpace Dev Hub</div>
            <div className="text-[11px] leading-tight text-muted-foreground">
              {connectedProviders.length > 0
                ? `${connectedProviders.length} integration${connectedProviders.length > 1 ? "s" : ""} connected`
                : "No integrations connected"}
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/settings"
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary/40"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Link>
        </nav>
      </div>
    </header>
  );
}
