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
    <main className="relative z-[2] mx-auto max-w-2xl px-4 sm:px-10 pb-14 pt-10">
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
