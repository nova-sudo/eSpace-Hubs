"use client";

/**
 * Admin Hub — overview page. Renders at /admin.
 *
 * Org-wide quick stats + entry points to the deeper admin pages
 * (hub-config, users, audit). Designed to be the calm landing
 * surface — three cards in a row, dense but readable, no spinners
 * on the happy path.
 *
 * Data sources:
 *   /api/v1/hubs/me           — what this org's hub map looks like
 *                                after admin overrides
 *   /api/v1/hub-configs       — list of override rows
 *   (users / audit counts are TBD; placeholders for now)
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";
import { useHubLink } from "@/features/hubs";
import { useSession } from "@/features/auth";

export function AdminDashboard() {
  const link = useHubLink();
  const { user } = useSession();
  const [hubsState, setHubsState] = useState({ loading: true, hubs: [], err: null });
  const [configsState, setConfigsState] = useState({ loading: true, configs: [], err: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/hubs/me");
      if (cancelled) return;
      if (r.ok) {
        setHubsState({ loading: false, hubs: r.data?.hubs ?? [], err: null });
      } else {
        setHubsState({ loading: false, hubs: [], err: r.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/hub-configs");
      if (cancelled) return;
      if (r.ok) {
        setConfigsState({
          loading: false,
          configs: r.data?.configs ?? [],
          err: null,
        });
      } else {
        setConfigsState({ loading: false, configs: [], err: r.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="relative z-[2] mx-auto max-w-6xl px-10 pb-14 pt-10">
      <header className="mb-8">
        <div
          className="mb-2 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          Admin · overview
        </div>
        <h1
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            letterSpacing: "-0.6px",
            lineHeight: 1.1,
          }}
        >
          Org administration.
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-[1.55] text-muted-fg">
          Configure which hubs your org sees, manage member roles, and
          audit privileged actions.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Hubs visible to your org"
          value={
            hubsState.loading
              ? "—"
              : `${hubsState.hubs.length}`
          }
          sub={
            hubsState.loading
              ? "loading"
              : hubsState.hubs.map((h) => h.label).join(" · ")
          }
        />
        <StatCard
          label="Active config overrides"
          value={
            configsState.loading
              ? "—"
              : `${configsState.configs.length}`
          }
          sub={
            configsState.loading
              ? "loading"
              : configsState.configs.length === 0
                ? "using registry defaults"
                : configsState.configs
                    .map((c) => c.hubId)
                    .join(", ")
          }
        />
        <StatCard
          label="Your roles"
          value={user?.roles?.length ?? 0}
          sub={user?.roles?.join(" · ") || "—"}
        />
      </div>

      <div className="mt-10 grid grid-cols-3 gap-4">
        <NavCard
          href={link("/hub-config")}
          title="Hub configuration"
          body="Toggle integrations, hide pages, override department mappings per hub. Backed by the M10.5 override layer."
        />
        <NavCard
          href={link("/users")}
          title="User management"
          body="Manage roles + status + hub access per user. Self-edits can't strip your own admin role or disable your own account."
        />
        <NavCard
          href={link("/audit")}
          title="Audit log"
          body="Privileged-action history — invites, role changes, hub overrides, password resets, integration connect/disconnect. Filterable + paginated."
        />
      </div>
    </main>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div
      className="rounded-md border border-border bg-card p-5"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <div
        className="uppercase tracking-[0.4px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
      >
        {label}
      </div>
      <div
        className="mt-2 font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 32,
          letterSpacing: "-0.5px",
        }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[12px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {sub}
      </div>
    </div>
  );
}

function NavCard({ href, title, body, comingSoon }) {
  return (
    <Link
      href={href}
      className="block rounded-md border border-border bg-card p-5 transition-colors hover:bg-accent-dim/40"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">{title}</div>
        {comingSoon ? (
          <span
            className="rounded-full border border-dashed border-border px-2 py-0.5 text-dim-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            soon
          </span>
        ) : (
          <span
            className="text-accent"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            →
          </span>
        )}
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-fg">{body}</p>
    </Link>
  );
}
