"use client";

/**
 * Admin Hub — generic "coming soon" shell for slots that don't have
 * their full UI yet (users, audit). Mirrors the QA placeholder
 * pattern from M10.3.
 *
 * Surfaces the slot's purpose, the backend endpoints that need to
 * land before the UI is real, and a back link to the admin
 * dashboard.
 */

import Link from "next/link";
import { useActiveHubStrict, useHubLink } from "@/features/hubs";

const COPY = {
  users: {
    title: "User management",
    body: "List every member of your org, edit their roles (multi-select), and manage hub access per user.",
    pending: "Backend: GET /api/v1/admin/users + PATCH /api/v1/admin/users/:id",
  },
  audit: {
    title: "Audit log",
    body: "Filterable list of privileged actions — invites, role changes, hub overrides, password resets — with actor + IP + timestamp.",
    pending: "Backend: GET /api/v1/admin/audit?since=…&limit=…",
  },
  default: {
    title: "Coming soon",
    body: "This admin surface is scaffolded — backend wiring lands next.",
    pending: null,
  },
};

export function AdminPlaceholder({ slot = "default" }) {
  const hub = useActiveHubStrict();
  const link = useHubLink();
  const copy = COPY[slot] ?? COPY.default;

  return (
    <main className="relative z-[2] mx-auto max-w-2xl px-10 pb-14 pt-10">
      <div
        className="mb-2 uppercase tracking-[0.5px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
      >
        {hub.label} · {slot}
      </div>
      <h1
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          letterSpacing: "-0.5px",
        }}
      >
        {copy.title}
      </h1>
      <p className="mt-2 max-w-xl text-[14px] leading-[1.55] text-muted-fg">
        {copy.body}
      </p>

      <div
        className="mt-6 rounded-md border border-dashed border-border bg-card-alt p-4"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
      >
        <div className="mb-1 uppercase tracking-[0.4px] text-dim-fg">
          Status
        </div>
        <div className="text-muted-fg">
          UI scaffolded. {copy.pending ?? "Backend endpoint TBD."}
        </div>
      </div>

      <div className="mt-6">
        <Link
          href={link("")}
          className="text-[11px] font-bold uppercase tracking-[0.5px] text-accent hover:underline"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          ← Admin dashboard
        </Link>
      </div>
    </main>
  );
}
