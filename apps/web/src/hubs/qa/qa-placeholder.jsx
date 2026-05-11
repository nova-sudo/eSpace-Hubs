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
import { MonoLabel, PageHeader } from "@/components/ui";
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
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <PageHeader
        crumb={`${hub.label} · ${slotLabel}`}
        title="We're still building this."
        italicWord="building"
        subtitle={hub.description}
      />

      <div className="mx-auto max-w-2xl">
        <div className="rounded-md border border-border bg-card p-6">
          <MonoLabel>Coming soon</MonoLabel>
          <p className="mt-2 text-[13.5px] leading-[1.65] text-fg">
            The {hub.label} is scaffolded — auth, hub routing, theming, and
            integration access are all wired up. The {slotLabel.toLowerCase()}{" "}
            view is the next piece of UI to land.
          </p>

          {slot === "dashboard" && widgets.length > 0 ? (
            <div className="mt-5 border-t border-border pt-4">
              <MonoLabel>Planned widgets</MonoLabel>
              <ul
                className="mt-2 grid gap-1.5"
                style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
              >
                {widgets.map((w) => (
                  <li
                    key={w}
                    className="rounded-sm border border-dashed border-border px-2.5 py-1.5 text-muted-fg"
                  >
                    <span className="text-fg">·</span> {w}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 border-t border-border pt-4">
            <MonoLabel>What you can do today</MonoLabel>
            <ul className="mt-2 grid gap-1.5 text-[12.5px] text-muted-fg">
              <li>
                <span className="text-fg">·</span>{" "}
                Connect{" "}
                {hub.allowedIntegrations.map((p, i, arr) => (
                  <span key={p}>
                    <Link
                      href={`/${hub.id}/settings`}
                      className="text-accent hover:underline"
                    >
                      {p}
                    </Link>
                    {i < arr.length - 1 ? (i === arr.length - 2 ? " and " : ", ") : ""}
                  </span>
                ))}{" "}
                in Settings — they'll be live the moment the {slotLabel.toLowerCase()} ships.
              </li>
              <li>
                <span className="text-fg">·</span>{" "}
                <Link
                  href={`/${hub.id}/goals`}
                  className="text-accent hover:underline"
                >
                  Add your performance goals
                </Link>{" "}
                — the goals tree is hub-agnostic and works today.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
