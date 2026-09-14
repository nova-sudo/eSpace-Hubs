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
import { ArrowRight } from "lucide-react";
import { PageHeader, Stat } from "@/components/ui";
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
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb="Admin · overview"
        title="Org administration."
        subtitle="Configure which hubs your org sees, manage member roles, and audit privileged actions."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <Stat
            label="Hubs visible to your org"
            value={hubsState.loading ? "—" : `${hubsState.hubs.length}`}
            sub={hubsState.loading ? "loading" : hubsState.hubs.map((h) => h.label).join(" · ")}
          />
        </div>
        <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <Stat
            label="Active config overrides"
            value={configsState.loading ? "—" : `${configsState.configs.length}`}
            sub={
              configsState.loading
                ? "loading"
                : configsState.configs.length === 0
                  ? "using registry defaults"
                  : configsState.configs.map((c) => c.hubId).join(", ")
            }
          />
        </div>
        <div className="rounded-[var(--radius-xl)] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <Stat label="Your roles" value={user?.roles?.length ?? 0} sub={user?.roles?.join(" · ") || "—"} />
        </div>
      </div>

      <div className="mt-9 grid grid-cols-1 sm:grid-cols-3 gap-4">
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

function NavCard({ href, title, body }) {
  return (
    <Link
      href={href}
      className="block rounded-[var(--radius-xl)] bg-card p-5 transition-colors hover:bg-card-alt"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-bold">{title}</div>
        <ArrowRight size={14} className="text-fg" />
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-fg">{body}</p>
    </Link>
  );
}
