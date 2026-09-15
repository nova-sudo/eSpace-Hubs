"use client";

/**
 * Admin hub — hubs & pages. A4.
 *
 *   GET    /api/v1/hub-configs           the org's override rows
 *   PUT    /api/v1/hub-configs/:hubId    upsert
 *   DELETE /api/v1/hub-configs/:hubId    revert to registry defaults
 *
 * One boolean matrix, read two ways. Retool's View by Object / View by
 * Role: "what does this hub expose" and "which hubs expose Evidence"
 * are the same table transposed, and an admin asks both.
 *
 * Two behaviours this page had to fix.
 *
 *   1. Every destructive toggle now confirms. Hiding a page, disabling
 *      a hub, dropping an integration and reverting a hub all write
 *      org-wide for every member; the previous UI hid a page on a
 *      single click of a small × with no confirmation at all.
 *   2. A failed save reverts the local state. The old code's comment
 *      claimed "On failure we toast + revert" but it only toasted, so a
 *      rejected write left the UI showing a change the server never
 *      accepted.
 *
 * Why the registry and not /hubs/me. /hubs/me returns hubs already
 * merged AND already filtered by the caller's capabilities and by
 * `enabled` — so a hub an admin had just disabled vanished from the
 * page that disables it, with no way back. This page reads the shared
 * registry for defaults and the raw override rows for the deltas, and
 * applies the same merge rules the server does (admin-lib.js). A
 * disabled hub therefore stays on screen, greyed, with its switch
 * intact.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPut } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import {
  Badge,
  Button,
  Checkbox,
  Label,
  Loading,
  PageHeader,
  SegmentedControl,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import {
  ALL_PROVIDERS,
  HUBS,
  HUB_ORDER,
  PAGE_SLOTS,
} from "@espace-devhub/shared/hubs";
import { AdminNotAuthorised, AdminShell } from "./admin-shell";
import {
  availableSlots,
  effectiveIntegrations,
  effectivePages,
  hubEnabled,
  pageLabel,
} from "./admin-lib";
import { TogglePill, useConfirm } from "./admin-ui";

// Sourced from the shared registry so a new provider (jenkins, the
// imminent zephyr, …) shows up here automatically. Hard-coding this
// list is what once hid jenkins from QA hub config.
const ALL_INTEGRATIONS = [...ALL_PROVIDERS];

const LENSES = [
  { value: "hub", label: "By hub" },
  { value: "page", label: "By page" },
];

export function AdminHubConfig() {
  const { user } = useSession();
  const confirm = useConfirm();

  const [configsByHub, setConfigsByHub] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingHubId, setSavingHubId] = useState(null);
  const [lens, setLens] = useState("hub");

  // Server-side enforcement already exists; rendering the editor to
  // someone who can't use it would just be confusing.
  const canConfigure = user?.capabilities?.includes(
    CAPABILITIES.ADMIN_HUBS_CONFIGURE,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/hub-configs");
      if (cancelled) return;
      if (!r.ok) {
        toast.error(r.error?.message || "Couldn't load hub overrides.");
        setLoading(false);
        return;
      }
      const map = {};
      for (const c of r.data?.configs ?? []) map[c.hubId] = c;
      setConfigsByHub(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Apply locally, write, and put the previous state back if the write
   * is rejected. `optimistic` is the whole next override row for this
   * hub (or null to drop it) — the server replaces `pages` and
   * `allowedIntegrations` wholesale, so every caller computes a full
   * value rather than a delta.
   */
  async function save(hubId, patch, optimistic, successMessage) {
    const snapshot = configsByHub;
    setConfigsByHub((prev) => ({ ...prev, [hubId]: optimistic }));
    setSavingHubId(hubId);
    const r = await apiPut(`/hub-configs/${hubId}`, patch);
    setSavingHubId(null);
    if (!r.ok) {
      setConfigsByHub(snapshot); // the revert the old code only claimed
      toast.error(r.error?.message || "Couldn't save the override.");
      return;
    }
    setConfigsByHub((prev) => ({ ...prev, [hubId]: r.data?.config ?? null }));
    toast.success(successMessage);
  }

  async function revert(hubId) {
    const snapshot = configsByHub;
    setConfigsByHub((prev) => {
      const next = { ...prev };
      delete next[hubId];
      return next;
    });
    setSavingHubId(hubId);
    const r = await apiDelete(`/hub-configs/${hubId}`);
    setSavingHubId(null);
    if (!r.ok) {
      setConfigsByHub(snapshot);
      toast.error(r.error?.message || "Couldn't revert the override.");
      return;
    }
    toast.success(`${HUBS[hubId]?.label ?? hubId} is back on registry defaults.`);
  }

  /** Every hub in the registry, with its override merged in. */
  const hubs = useMemo(
    () =>
      HUB_ORDER.map((id) => {
        const registry = HUBS[id];
        const override = configsByHub[id] ?? null;
        return {
          id,
          label: registry?.label ?? id,
          enabled: hubEnabled(override),
          hasOverride: !!override,
          override,
          pages: effectivePages(registry?.pages, override?.pages),
          slots: availableSlots(registry?.pages, override?.pages),
          integrations: effectiveIntegrations(
            registry?.allowedIntegrations,
            override,
          ),
        };
      }),
    [configsByHub],
  );

  /** Slot ids any hub could expose, in registry order first. */
  const slots = useMemo(() => {
    const seen = new Set();
    for (const hub of hubs) for (const s of hub.slots) seen.add(s);
    const ordered = PAGE_SLOTS.filter((s) => seen.has(s));
    const extras = [...seen].filter((s) => !PAGE_SLOTS.includes(s)).sort();
    return [...ordered, ...extras];
  }, [hubs]);

  function togglePage(hub, slot, nextOn) {
    const nextPages = { ...(hub.override?.pages ?? {}) };
    if (nextOn) {
      // Dropping the key restores the registry default for the slot —
      // the merge treats an absent key as "pass through".
      delete nextPages[slot];
    } else {
      nextPages[slot] = null;
    }
    const optimistic = { ...(hub.override ?? { hubId: hub.id }), pages: nextPages };
    const run = () =>
      save(
        hub.id,
        { pages: nextPages },
        optimistic,
        nextOn
          ? `${pageLabel(slot)} is back on ${hub.label}.`
          : `${pageLabel(slot)} is hidden on ${hub.label}.`,
      );

    if (nextOn) {
      void run();
      return;
    }
    confirm({
      title: `Hide ${pageLabel(slot)} from ${hub.label}?`,
      body: `Everyone in this org loses that page in the ${hub.label} hub on their next page load. Links to it stop resolving. You can turn it back on here.`,
      confirmLabel: "Hide the page",
      onConfirm: run,
    });
  }

  function toggleHubEnabled(hub, nextOn) {
    const optimistic = { ...(hub.override ?? { hubId: hub.id }), enabled: nextOn };
    const run = () =>
      save(
        hub.id,
        { enabled: nextOn },
        optimistic,
        nextOn
          ? `${hub.label} is visible to the org again.`
          : `${hub.label} is hidden from the org.`,
      );
    if (nextOn) {
      void run();
      return;
    }
    confirm({
      title: `Hide ${hub.label} from the whole org?`,
      body: "Every member loses the hub — its nav entry, its pages, and its place in the hub switcher. Anyone whose primary hub this is gets bounced to another one. Nothing is deleted, and you can turn it back on here.",
      confirmLabel: "Hide the hub",
      onConfirm: run,
    });
  }

  function toggleIntegration(hub, provider, nextOn) {
    const next = nextOn
      ? [...hub.integrations, provider]
      : hub.integrations.filter((p) => p !== provider);
    const optimistic = {
      ...(hub.override ?? { hubId: hub.id }),
      allowedIntegrations: next,
    };
    const run = () =>
      save(
        hub.id,
        { allowedIntegrations: next },
        optimistic,
        nextOn
          ? `${provider} allowed on ${hub.label}.`
          : `${provider} removed from ${hub.label}.`,
      );
    if (nextOn) {
      void run();
      return;
    }
    confirm({
      title: `Remove ${provider} from ${hub.label}?`,
      body: `Widgets in the ${hub.label} hub that read from ${provider} stop resolving for every member of the org. Stored credentials are not deleted.`,
      confirmLabel: `Remove ${provider}`,
      onConfirm: run,
    });
  }

  function askRevert(hub) {
    confirm({
      title: `Revert ${hub.label} to registry defaults?`,
      body: "Every override on this hub — visibility, hidden pages, integrations — is dropped at once and the shipped configuration takes over.",
      confirmLabel: "Revert",
      onConfirm: () => revert(hub.id),
    });
  }

  if (!canConfigure) {
    return (
      <AdminNotAuthorised
        active="hub-config"
        crumb="Admin · hubs & pages"
        capability={CAPABILITIES.ADMIN_HUBS_CONFIGURE}
      />
    );
  }

  const customCount = hubs.filter((h) => h.hasOverride).length;

  return (
    <AdminShell active="hub-config">
      <PageHeader
        crumb="Admin · hubs & pages"
        title="What each hub exposes."
        subtitle="A checkbox per hub and page. Overrides merge on top of the shipped defaults, so an unchecked box means this org hid the page — not that it never existed. Changes land on each member's next page load."
        right={
          <SegmentedControl
            size="sm"
            options={LENSES}
            value={lens}
            onChange={setLens}
          />
        }
      />

      {loading ? (
        <Loading label="Loading hub configuration" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Label>
              {hubs.length} hubs ·{" "}
              {customCount === 0
                ? "all on registry defaults"
                : `${customCount} with overrides`}
            </Label>
          </div>

          <div
            className="overflow-hidden rounded-[var(--radius-xl)] bg-card"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="overflow-x-auto">
              {lens === "hub" ? (
                <ByHubMatrix
                  hubs={hubs}
                  slots={slots}
                  savingHubId={savingHubId}
                  onTogglePage={togglePage}
                  onToggleHub={toggleHubEnabled}
                />
              ) : (
                <ByPageMatrix
                  hubs={hubs}
                  slots={slots}
                  savingHubId={savingHubId}
                  onTogglePage={togglePage}
                  onToggleHub={toggleHubEnabled}
                />
              )}
            </div>
          </div>

          <h2 className="mb-3.5 mt-8 text-[18px] font-bold tracking-[-0.01em] text-fg">
            Integrations per hub
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {hubs.map((hub) => (
              <IntegrationsCard
                key={hub.id}
                hub={hub}
                saving={savingHubId === hub.id}
                onToggle={(provider, nextOn) =>
                  toggleIntegration(hub, provider, nextOn)
                }
                onRevert={() => askRevert(hub)}
              />
            ))}
          </div>
        </>
      )}

      {confirm.dialog}
    </AdminShell>
  );
}

/* ══════════════════════════ the two lenses ══════════════════════════ */

/** Pages down the side, hubs across the top. */
function ByHubMatrix({ hubs, slots, savingHubId, onTogglePage, onToggleHub }) {
  const cols = `grid items-center gap-3`;
  const style = {
    gridTemplateColumns: `minmax(180px,1fr) repeat(${hubs.length}, 104px)`,
  };
  return (
    <div className="min-w-[640px] px-5">
      <div className={cn(cols, "border-b border-line py-3")} style={style}>
        <Label>Page</Label>
        {hubs.map((hub) => (
          <div key={hub.id} className="text-center">
            <div
              className={cn(
                "text-[12.5px] font-bold text-fg",
                !hub.enabled && "opacity-55",
              )}
            >
              {hub.label}
            </div>
            <div className="mt-1.5">
              <HubSwitch
                hub={hub}
                saving={savingHubId === hub.id}
                onToggle={onToggleHub}
              />
            </div>
          </div>
        ))}
      </div>

      {slots.map((slot) => (
        <div
          key={slot}
          className={cn(cols, "border-b border-line py-2.5 last:border-b-0")}
          style={style}
        >
          <span className="truncate text-[13px] font-semibold text-fg">
            {pageLabel(slot)}
          </span>
          {hubs.map((hub) => (
            <div key={hub.id} className="flex justify-center">
              <MatrixCell
                hub={hub}
                slot={slot}
                saving={savingHubId === hub.id}
                onToggle={onTogglePage}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The same table transposed: hubs down the side, pages across the top. */
function ByPageMatrix({ hubs, slots, savingHubId, onTogglePage, onToggleHub }) {
  const cols = `grid items-center gap-3`;
  const style = {
    gridTemplateColumns: `minmax(170px,1fr) repeat(${slots.length}, 92px)`,
  };
  return (
    <div style={{ minWidth: 190 + slots.length * 104 }} className="px-5">
      <div className={cn(cols, "border-b border-line py-3")} style={style}>
        <Label>Hub</Label>
        {slots.map((slot) => (
          <div
            key={slot}
            className="text-center text-[11.5px] font-bold leading-[1.25] text-muted-fg"
          >
            {pageLabel(slot)}
          </div>
        ))}
      </div>

      {hubs.map((hub) => (
        <div
          key={hub.id}
          className={cn(cols, "border-b border-line py-2.5 last:border-b-0")}
          style={style}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "truncate text-[13px] font-bold text-fg",
                !hub.enabled && "opacity-55",
              )}
            >
              {hub.label}
            </span>
            <HubSwitch
              hub={hub}
              saving={savingHubId === hub.id}
              onToggle={onToggleHub}
            />
          </div>
          {slots.map((slot) => (
            <div key={slot} className="flex justify-center">
              <MatrixCell
                hub={hub}
                slot={slot}
                saving={savingHubId === hub.id}
                onToggle={onTogglePage}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * One intersection. A slot the hub never ships shows a dash rather than
 * an empty box, because ticking it would have nothing to point at — the
 * registry, not this org, decides which hub owns which page.
 */
function MatrixCell({ hub, slot, saving, onToggle }) {
  const available = hub.slots.has(slot);
  if (!available) {
    return (
      <span
        className="text-[13px] text-dim-fg"
        title={`${hub.label} doesn't ship ${pageLabel(slot)}.`}
        aria-label={`${pageLabel(slot)} is not part of ${hub.label}`}
      >
        —
      </span>
    );
  }
  const on = Boolean(hub.pages[slot]);
  return (
    <span
      title={
        on
          ? `Hide ${pageLabel(slot)} from ${hub.label}`
          : `Show ${pageLabel(slot)} on ${hub.label} again`
      }
      className={cn(
        "inline-flex",
        saving && "pointer-events-none opacity-50",
        !hub.enabled && "opacity-55",
      )}
    >
      <Checkbox
        checked={on}
        onChange={() => {
          if (!saving) onToggle(hub, slot, !on);
        }}
        label={`${pageLabel(slot)} on ${hub.label}`}
      />
    </span>
  );
}

/** The org-wide visibility switch for one hub. */
function HubSwitch({ hub, saving, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={hub.enabled}
      aria-label={`${hub.label} visible to the org`}
      title={
        hub.enabled
          ? `Hide ${hub.label} from the whole org`
          : `Show ${hub.label} to the org again`
      }
      disabled={saving}
      onClick={() => onToggle(hub, !hub.enabled)}
      className="disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Badge tone={hub.enabled ? "mint" : "neutral"} dot>
        {hub.enabled ? "Visible" : "Hidden"}
      </Badge>
    </button>
  );
}

/* ══════════════════════════ integrations ══════════════════════════ */

function IntegrationsCard({ hub, saving, onToggle, onRevert }) {
  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-bold text-fg">{hub.label}</span>
        {hub.hasOverride ? <Badge tone="lav">Custom</Badge> : null}
        {!hub.enabled ? <Badge tone="peach">Hidden</Badge> : null}
        <span className="flex-1" />
        {hub.hasOverride ? (
          <Button
            type="button"
            variant="soft"
            size="sm"
            onClick={onRevert}
            disabled={saving}
          >
            Revert to defaults
          </Button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-muted-fg">
        {hub.integrations.length === 0
          ? "No providers — this hub surfaces no integration data."
          : `Providers this hub may read: ${hub.integrations.join(", ")}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ALL_INTEGRATIONS.map((p) => {
          const on = hub.integrations.includes(p);
          return (
            <TogglePill
              key={p}
              checked={on}
              disabled={saving}
              onClick={() => onToggle(p, !on)}
              title={
                on
                  ? `Remove ${p} from ${hub.label}`
                  : `Allow ${p} on ${hub.label}`
              }
            >
              {p}
            </TogglePill>
          );
        })}
      </div>
    </div>
  );
}
