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
import { Label, PageHeader } from "@/components/ui";
import { useActiveHubStrict, useHubLink } from "@/features/hubs";

// #239: this used to print internal API routes ("Backend: GET
// /api/v1/admin/users + PATCH …") into user-facing copy — engineering
// notes are for the tracker, not the page. (The users/audit entries are
// also dead: both slots have real pages now.)
const COPY = {
  default: {
    title: "Coming soon",
    body: "This admin surface is on the roadmap — it isn't wired up yet.",
  },
};

export function AdminPlaceholder({ slot = "default" }) {
  const hub = useActiveHubStrict();
  const link = useHubLink();
  const copy = COPY[slot] ?? COPY.default;

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader crumb={`${hub.label} · ${slot}`} title={copy.title} subtitle={copy.body} />

      <div className="rounded-[var(--radius-xl)] bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <Label>Coming soon</Label>
        <p className="mt-2 text-[13.5px] leading-[1.65] text-fg">{copy.body}</p>
        <Link href={link("")} className="mt-4 inline-block text-[12.5px] font-bold text-fg">
          ← Admin dashboard
        </Link>
      </div>
    </main>
  );
}
