"use client";

import Link from "next/link";
import { BentoTile } from "@/components/ui";
import { useIntegrations } from "@/features/integrations";
import { useAllowedProviders, useHubLink } from "@/features/hubs";

export function IntegrationsTile() {
  const { integrations, isConnected } = useIntegrations();
  const link = useHubLink();
  // M10.4: only count + show providers the active hub allows. The
  // "connected" status comes from the global integrations store (a
  // connection made under another hub still counts as connected when
  // the user switches back to that hub), but the tile's denominator
  // is the hub's allowed set so the ratio reads as "X / Y for this hub".
  const allowed = useAllowedProviders();
  const allowedIds = new Set(allowed.map((p) => p.id));
  const connectedHere = Array.from(allowedIds).filter((id) => isConnected(id));

  return (
    <BentoTile
      col="span 3"
      row="span 2"
      label={`Integrations · ${connectedHere.length} / ${allowed.length}`}
      right={
        <Link
          href={link("/settings")}
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg hover:text-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Manage ↗
        </Link>
      }
    >
      <div className="mt-1 flex flex-col gap-2">
        {allowed.map((p) => {
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
