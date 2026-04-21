"use client";

import Link from "next/link";
import { Plug, Check, X } from "lucide-react";
import { BentoTile } from "./bento-grid";
import { PROVIDERS } from "@/lib/integrations";
import { useIntegrations } from "@/hooks/use-integrations";
import { cn } from "@/lib/utils";

export function ConnectedIntegrationsTile() {
  const { isConnected, integrations } = useIntegrations();

  return (
    <BentoTile
      title="Connected Integrations"
      subtitle="Accounts feeding this dashboard"
      icon={Plug}
      colSpan="md:col-span-2"
      rowSpan="row-span-2"
      action={
        <Link
          href="/settings"
          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          Manage
        </Link>
      }
    >
      <ul className="flex h-full flex-col justify-center gap-2">
        {Object.values(PROVIDERS).map((p) => {
          const connected = isConnected(p.id);
          const meta = integrations[p.id];
          return (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: p.color }}
                />
                <span className="text-sm font-medium">{p.label}</span>
                {meta?.username ? (
                  <span className="text-xs text-muted-foreground">@{meta.username}</span>
                ) : null}
              </div>
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  connected
                    ? "bg-success/15 text-success"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {connected ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {connected ? "Connected" : "Not connected"}
              </span>
            </li>
          );
        })}
      </ul>
    </BentoTile>
  );
}
