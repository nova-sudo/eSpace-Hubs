"use client";

import Link from "next/link";
import { BentoTile } from "@/components/ui";
import { PROVIDERS, useIntegrations } from "@/features/integrations";

export function IntegrationsTile() {
  const { integrations, isConnected, connectedProviders } = useIntegrations();

  return (
    <BentoTile
      col="span 3"
      row="span 2"
      label={`Integrations · ${connectedProviders.length} / ${Object.keys(PROVIDERS).length}`}
      right={
        <Link
          href="/settings"
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg hover:text-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Manage ↗
        </Link>
      }
    >
      <div className="mt-1 flex flex-col gap-2">
        {Object.values(PROVIDERS).map((p) => {
          const connected = isConnected(p.id);
          const meta = integrations[p.id];
          return (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-[var(--radius-sub)] border border-border bg-card-alt px-2.5 py-2"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="grid h-[26px] w-[26px] place-items-center rounded-[var(--radius-sub)] bg-accent-dim font-bold text-accent"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                >
                  {p.glyph}
                </span>
                <div>
                  <div className="text-[13px] font-semibold">{p.label}</div>
                  <div
                    className="text-dim-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
                  >
                    {meta?.username
                      ? `@${meta.username}`
                      : connected
                        ? "connected"
                        : "not connected"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span
                  className="block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: connected ? "var(--accent-2)" : "var(--dim-fg)",
                  }}
                />
                <span
                  className="uppercase text-muted-fg"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                >
                  {connected ? "OK" : "OFF"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </BentoTile>
  );
}
