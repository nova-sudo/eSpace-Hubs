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
    return (
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--muted-fg)",
        }}
      >
        Loading devices…
      </p>
    );
  }

  if (error) {
    return (
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--bad)",
        }}
      >
        {error}
      </p>
    );
  }

  if (devices.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: "var(--muted-fg)",
          lineHeight: 1.6,
        }}
      >
        No paired devices. Install the companion app on a laptop, click
        “Pair this device,” then approve the prompt that opens in this
        browser.
      </p>
    );
  }

  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {devices.map((d) => (
        <li
          key={d.id}
          style={{
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sub, 3px)",
            background: "var(--card)",
            padding: 14,
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{d.name}</span>
            <DevicesMeta device={d} />
          </div>
          <button
            type="button"
            onClick={() => handleRevoke(d)}
            disabled={revokingId === d.id}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              background: "transparent",
              color: "var(--bad)",
              border: "1px solid var(--bad)",
              borderRadius: "var(--radius-sub, 3px)",
              padding: "6px 12px",
              cursor: revokingId === d.id ? "wait" : "pointer",
              opacity: revokingId === d.id ? 0.5 : 1,
              alignSelf: "start",
            }}
          >
            {revokingId === d.id ? "Revoking…" : "Revoke"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DevicesMeta({ device }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        rowGap: 2,
        columnGap: 10,
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        color: "var(--muted-fg)",
      }}
    >
      <Row
        label="Paired"
        value={
          device.createdAt
            ? new Date(device.createdAt).toLocaleString()
            : "—"
        }
      />
      <Row
        label="Last used"
        value={
          device.lastUsedAt
            ? new Date(device.lastUsedAt).toLocaleString()
            : "—"
        }
      />
      {device.createdByIp ? (
        <Row label="From IP" value={device.createdByIp} />
      ) : null}
      {device.createdByUa ? (
        <Row label="User agent" value={device.createdByUa} />
      ) : null}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <>
      <span
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          fontSize: 9.5,
        }}
      >
        {label}
      </span>
      <span style={{ overflowWrap: "anywhere" }}>{value}</span>
    </>
  );
}
