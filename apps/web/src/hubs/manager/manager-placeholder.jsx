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
import { MonoLabel, PageHeader } from "@/components/ui";
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
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <PageHeader
        crumb={`${hub.label} · ${slotLabel}`}
        title="Landing in the next drop."
        italicWord="next"
        subtitle={SLOT_BLURB[slot] ?? hub.description}
      />

      <div className="mx-auto max-w-2xl">
        <div className="rounded-md border border-border bg-card p-6">
          <MonoLabel>Coming soon</MonoLabel>
          <p className="mt-2 text-[13.5px] leading-[1.65] text-fg">
            The Manager hub is scaffolded — auth, capability gating, hub
            routing, and the warm-white/orange theme are all wired. The{" "}
            {slotLabel.toLowerCase()} view is the next piece of UI to land.
          </p>

          <div className="mt-5 border-t border-border pt-4">
            <MonoLabel>In the meantime</MonoLabel>
            <p className="mt-2 text-[12.5px] leading-[1.6] text-muted-fg">
              Your{" "}
              <Link
                href={`/${hub.id}`}
                className="text-accent hover:underline"
              >
                team roster
              </Link>{" "}
              is on the dashboard.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
