"use client";

/**
 * Lists the user's paired companion devices.
 *
 *   GET    /api/v1/companion/devices         — list (excludes revoked)
 *   DELETE /api/v1/companion/devices/:id     — soft-revoke
 *
 * Used inside the CompanionTab (Settings → Companion). Read-only
 * surface for the user to audit "what laptops have my Dev Hub token?"
 * and pull the plug if a device walks off.
 *
 * The bearer token is NEVER returned by either endpoint — `devices`
 * surfaces only the name + IP + ua + timestamps so revocation never
 * exposes the secret material to the browser.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Badge, Card, IconButton, TileState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { apiDelete, apiGet } from "@/lib/api-client";

export function DevicesList() {
  const [devices, setDevices] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [revokingId, setRevokingId] = useState(null);

  const refresh = async () => {
    setError(null);
    const r = await apiGet("/companion/devices");
    if (!r.ok) {
      setError(r.error?.message || "Couldn't load devices.");
      setDevices([]);
      return;
    }
    setDevices(r.data?.devices ?? []);
  };

  useEffect(() => {
    void refresh();
  }, []);

  async function handleRevoke(d) {
    const ok = window.confirm(
      `Revoke ${d.name}? The companion app on that machine will need to be re-paired before it can route traffic again.`,
    );
    if (!ok) return;
    setRevokingId(d.id);
    const r = await apiDelete(`/companion/devices/${d.id}`);
    setRevokingId(null);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't revoke that device.");
      return;
    }
    toast.success(`${d.name} revoked.`);
    await refresh();
  }

  if (devices === null) {
    return <TileState kind="loading" message="Loading devices…" />;
  }

  if (error) {
    return <TileState kind="error" message={error} />;
  }

  if (devices.length === 0) {
    return (
      <TileState
        kind="empty"
        message="No paired devices."
        sub={'Install the companion app on a laptop, click "Pair this device," then approve the prompt that opens in this browser.'}
      />
    );
  }

  return (
    <Card className="p-0">
      {devices.map((d, i) => (
        <div
          key={d.id}
          className={cn(
            "flex items-center justify-between gap-4 px-5 py-4",
            i > 0 && "border-t border-line",
          )}
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[14.5px] font-bold text-fg">{d.name}</span>
              {d.createdByUa ? (
                <Badge tone="neutral" className="max-w-[220px] truncate">
                  {d.createdByUa}
                </Badge>
              ) : null}
            </div>
            <DevicesMeta device={d} />
          </div>
          <IconButton
            label={revokingId === d.id ? "Revoking…" : `Revoke ${d.name}`}
            onCard
            onClick={() => handleRevoke(d)}
            disabled={revokingId === d.id}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      ))}
    </Card>
  );
}

function DevicesMeta({ device }) {
  const rows = [
    ["Paired", device.createdAt ? new Date(device.createdAt).toLocaleString() : "—"],
    ["Last used", device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString() : "—"],
  ];
  if (device.createdByIp) rows.push(["From IP", device.createdByIp]);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted-fg">
      {rows.map(([label, value]) => (
        <span key={label}>
          {label}: {value}
        </span>
      ))}
    </div>
  );
}
