"use client";

/**
 * Manager Hub — placeholder for slots whose real UI hasn't landed yet
 * (currently `employees`). Mirrors the QA placeholder's calm "still
 * building" shell, manager-flavoured. Replaced slot-by-slot across the
 * P1–P4 drops in docs/manager-hub-plan.md.
 *
 * Slot prop is the hub's page-slot id ("employees", …).
 */

import Link from "next/link";
import { Label, PageHeader } from "@/components/ui";
import { useActiveHubStrict } from "@/features/hubs";

const SLOT_LABELS = {
  dashboard: "Team",
  employees: "Employees",
  settings: "Settings",
};

const SLOT_BLURB = {
  employees:
    "Per-report goal boards — every engineer's goals, health, and evidence, with tier grading and delegated-goal verdicts.",
};

export function ManagerPlaceholder({ slot = "employees" }) {
  const hub = useActiveHubStrict();
  const slotLabel = SLOT_LABELS[slot] ?? slot;

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb={`${hub.label} · ${slotLabel}`}
        title="Landing in the next drop."
        subtitle={SLOT_BLURB[slot] ?? hub.description}
      />

      <div className="mx-auto max-w-2xl rounded-[var(--radius-xl)] bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <Label>Coming soon</Label>
        <p className="mt-2 text-[13.5px] leading-[1.65] text-fg">
          The Manager hub is scaffolded — auth, capability gating, hub
          routing, and page structure are all wired. The{" "}
          {slotLabel.toLowerCase()} view is the next piece of UI to land.
        </p>

        <div className="mt-5 border-t border-line pt-4">
          <Label>In the meantime</Label>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-muted-fg">
            Your team roster is on the dashboard.
          </p>
          <Link
            href={`/${hub.id}`}
            className="mt-3 inline-flex h-9 items-center rounded-[var(--radius-pill)] bg-card-alt px-4 text-[12.5px] font-semibold text-fg hover:opacity-80"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
