"use client";

/**
 * Admin Hub — hub-config editor. UI on top of the M10.5 endpoints:
 *   GET    /api/v1/hub-configs           list overrides
 *   PUT    /api/v1/hub-configs/:hubId    upsert
 *   DELETE /api/v1/hub-configs/:hubId    revert to defaults
 *
 * Renders one expandable row per registry hub. Per row the admin can:
 *   - Toggle `enabled` (hide the hub from the entire org)
 *   - Toggle individual `allowedIntegrations`
 *   - Toggle individual page slots (null = remove from effective map)
 *
 * Optimistic UI:
 *   - PUT requests fire on every change
 *   - The local state updates immediately
 *   - On failure we toast + revert
 *
 * Loading state: shows "Loading…" until both /hubs/me and /hub-configs
 * resolve. /hubs/me gives us the registry view (post-merge); /hub-configs
 * gives the raw override rows we display alongside.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPut } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { ALL_PROVIDERS } from "@espace-devhub/shared/hubs";

// Source the integration list from the shared registry so adding
// a new provider (e.g. PR A's `jenkins`, the imminent `zephyr`,
// future zoho/etc.) automatically appears as a togglable pill in
// the admin hub-config UI. Hardcoding here was the bug that hid
// jenkins from QA hub config after PR A merged.
const ALL_INTEGRATIONS = [...ALL_PROVIDERS];

export function AdminHubConfig() {
  const { user } = useSession();
  const [registryHubs, setRegistryHubs] = useState([]); // post-merge view from /hubs/me
  const [configsByHub, setConfigsByHub] = useState({}); // raw override rows by hubId
  const [loading, setLoading] = useState(true);
  const [openHubId, setOpenHubId] = useState(null);
  const [savingHubId, setSavingHubId] = useState(null);

  // Gate the entire page on the capability — server-side enforcement
  // already happens, but rendering this UI to a user who can't use
  // it would be confusing.
  const canConfigure = user?.capabilities?.includes(
    CAPABILITIES.ADMIN_HUBS_CONFIGURE,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [hubsR, configsR] = await Promise.all([
        apiGet("/hubs/me"),
        apiGet("/hub-configs"),
      ]);
      if (cancelled) return;
      if (hubsR.ok) {
        setRegistryHubs(hubsR.data?.hubs ?? []);
      }
      if (configsR.ok) {
        const map = {};
        for (const c of configsR.data?.configs ?? []) {
          map[c.hubId] = c;
        }
        setConfigsByHub(map);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveOverride(hubId, patch) {
    setSavingHubId(hubId);
    const r = await apiPut(`/hub-configs/${hubId}`, patch);
    setSavingHubId(null);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't save override.");
      return null;
    }
    setConfigsByHub((prev) => ({ ...prev, [hubId]: r.data?.config ?? null }));
    toast.success(`Saved override for ${hubId}.`);
    return r.data?.config;
  }

  async function revertOverride(hubId) {
    setSavingHubId(hubId);
    const r = await apiDelete(`/hub-configs/${hubId}`);
    setSavingHubId(null);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't revert override.");
      return;
    }
    setConfigsByHub((prev) => {
      const next = { ...prev };
      delete next[hubId];
      return next;
    });
    toast.success(`Reverted ${hubId} to registry defaults.`);
  }

  if (!canConfigure) {
    return (
      <main className="mx-auto max-w-3xl px-10 py-12">
        <h1 className="mb-3 text-[24px] font-semibold">Not authorised.</h1>
        <p className="text-[13px] text-muted-fg">
          This view requires the {CAPABILITIES.ADMIN_HUBS_CONFIGURE}{" "}
          capability. Ask your org admin to extend your roles.
        </p>
      </main>
    );
  }

  return (
    <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-14 pt-10">
      <header className="mb-8">
        <div
          className="mb-2 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          Admin · hub configuration
        </div>
        <h1
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            letterSpacing: "-0.5px",
          }}
        >
          Per-hub overrides.
        </h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-[1.55] text-muted-fg">
          Toggle integrations and pages per hub for this org. Overrides
          merge on top of registry defaults; an empty override means
          "use defaults". Changes take effect on the next /hubs/me
          round-trip (~one page load for each user).
        </p>
      </header>

      {loading ? (
        <div
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {registryHubs.map((hub) => (
            <HubRow
              key={hub.id}
              hub={hub}
              override={configsByHub[hub.id] ?? null}
              expanded={openHubId === hub.id}
              onExpand={() => setOpenHubId(openHubId === hub.id ? null : hub.id)}
              onSave={(patch) => saveOverride(hub.id, patch)}
              onRevert={() => revertOverride(hub.id)}
              saving={savingHubId === hub.id}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function HubRow({ hub, override, expanded, onExpand, onSave, onRevert, saving }) {
  // Effective values — registry default with override applied. The
  // /hubs/me response is already merged, so reading from `hub`
  // directly gives us the post-merge view.
  const enabled = override?.enabled === false ? false : true;
  const hasOverride = !!override;

  return (
    <div
      className="rounded-md border border-border bg-card"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-accent-dim/30"
      >
        <div className="flex items-center gap-3">
          <span
            className="block h-2 w-2 rounded-full"
            style={{
              background: enabled ? hub.theme.accent : "var(--dim-fg)",
            }}
          />
          <div>
            <div className="text-[14px] font-semibold">{hub.label}</div>
            <div
              className="text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
            >
              {hub.id} · {Object.keys(hub.pages).length} pages ·{" "}
              {hub.allowedIntegrations.length} integrations
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasOverride ? (
            <span
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              custom
            </span>
          ) : null}
          <span
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
          >
            {expanded ? "−" : "+"}
          </span>
        </div>
      </button>

      {expanded ? (
        <div
          className="border-t px-5 py-4"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <ToggleRow
            label="Visible to this org"
            value={enabled}
            disabled={saving}
            onChange={(v) => onSave({ enabled: v })}
          />

          <FieldRow label="Integrations">
            <div className="flex flex-wrap gap-1.5">
              {ALL_INTEGRATIONS.map((p) => {
                const on = hub.allowedIntegrations.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      const next = on
                        ? hub.allowedIntegrations.filter((x) => x !== p)
                        : [...hub.allowedIntegrations, p];
                      onSave({ allowedIntegrations: next });
                    }}
                    className="rounded-full border px-2.5 py-1 transition-colors"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      borderColor: on
                        ? "var(--accent)"
                        : "var(--border-strong)",
                      background: on ? "var(--accent-dim)" : "transparent",
                      color: on ? "var(--accent)" : "var(--muted-fg)",
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </FieldRow>

          <FieldRow label="Page slots">
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(hub.pages).map((slot) => (
                <button
                  key={slot}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    // Null out the slot in the override to remove it.
                    onSave({ pages: { ...(override?.pages ?? {}), [slot]: null } });
                  }}
                  className="rounded-full border border-border px-2.5 py-1 transition-colors hover:border-red-300 hover:text-red-600"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    opacity: saving ? 0.5 : 1,
                  }}
                  title={`Click to hide /${hub.id}/${slot} for this org`}
                >
                  {slot} ✕
                </button>
              ))}
            </div>
          </FieldRow>

          {hasOverride ? (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onRevert}
                disabled={saving}
                className="text-[11px] font-bold uppercase tracking-[0.4px] text-red-600 hover:underline disabled:opacity-50"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Revert to defaults
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToggleRow({ label, value, disabled, onChange }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-border py-2.5 last:border-b-0">
      <div className="text-[13px]">{label}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className="rounded-md border px-3 py-1 transition-colors"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 700,
          borderColor: value ? "var(--accent)" : "var(--border-strong)",
          background: value ? "var(--accent-dim)" : "transparent",
          color: value ? "var(--accent)" : "var(--muted-fg)",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {value ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div className="border-b border-dashed border-border py-3 last:border-b-0">
      <div
        className="mb-2 uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
