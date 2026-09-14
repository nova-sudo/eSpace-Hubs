"use client";

/**
 * Hub-coming-soon placeholder for slots that don't have real QA UI
 * yet. Renders a quiet card with the active hub's metadata + a list
 * of the widget ids the registry has reserved for this hub. Good
 * enough for M10.3 — real QA pages (defect leakage, test cycle time,
 * regression rates) land in follow-up PRs as the QA team's metrics
 * stabilise.
 *
 * Slot prop is the hub's page-slot id ("dashboard", "goals", …). Used
 * for the heading + to tell the user which slot they're looking at.
 */

import Link from "next/link";
import { Label, PageHeader } from "@/components/ui";
import { useActiveHubStrict } from "@/features/hubs";

const SLOT_LABELS = {
  dashboard: "Dashboard",
  goals: "Goals",
  evidence: "Evidence",
  snapshots: "Snapshots",
  reviews: "Reviews",
  settings: "Settings",
  analyst: "Analyst",
};

export function QaPlaceholder({ slot = "dashboard" }) {
  const hub = useActiveHubStrict();
  const slotLabel = SLOT_LABELS[slot] ?? slot;
  const widgets = Array.isArray(hub.widgets) ? hub.widgets : [];

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb={`${hub.label} · ${slotLabel}`}
        title="We're still building this."
        subtitle={hub.description}
      />

      <div className="mx-auto max-w-2xl rounded-[var(--radius-xl)] bg-card p-6" style={{ boxShadow: "var(--shadow-card)" }}>
        <Label>Coming soon</Label>
        <p className="mt-2 text-[13.5px] leading-[1.65] text-fg">
          The {hub.label} is scaffolded — auth, hub routing, theming, and
          integration access are all wired up. The {slotLabel.toLowerCase()}{" "}
          view is the next piece of UI to land.
        </p>

        {slot === "dashboard" && widgets.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <Label>Planned widgets</Label>
            <ul className="mt-2 grid gap-1.5">
              {widgets.map((w) => (
                <li key={w} className="rounded-[var(--radius-md)] bg-card-alt px-2.5 py-1.5 text-[12px] text-muted-fg">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 border-t border-line pt-4">
          <Label>What you can do today</Label>
          <ul className="mt-2 grid gap-1.5 text-[12.5px] text-muted-fg">
            <li>
              Connect{" "}
              {hub.allowedIntegrations.map((p, i, arr) => (
                <span key={p}>
                  <Link href={`/${hub.id}/settings`} className="font-bold text-fg">
                    {p}
                  </Link>
                  {i < arr.length - 1 ? (i === arr.length - 2 ? " and " : ", ") : ""}
                </span>
              ))}{" "}
              in Settings — they'll be live the moment the {slotLabel.toLowerCase()} ships.
            </li>
            <li>
              <Link href={`/${hub.id}/goals`} className="font-bold text-fg">
                Add your performance goals
              </Link>{" "}
              — the goals tree is hub-agnostic and works today.
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
