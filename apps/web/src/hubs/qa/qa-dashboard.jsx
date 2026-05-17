"use client";

/**
 * QA Hub dashboard. First real iteration — replaces the QaPlaceholder
 * for users on the QA hub. Scope of THIS PR (PR A):
 *
 *   - Header that matches the Dev hub's tone
 *   - <BuildPassRateTile> wired to Jenkins (the only data source
 *     guaranteed across both coder-QA and manual-QA workflows
 *     that we have a connector for today)
 *   - "Connect Jenkins" CTA when the user hasn't connected yet —
 *     the dashboard stays useful (and obviously empty) instead of
 *     just rendering nothing
 *
 * Future PRs in this arc will add:
 *   - PR B: Zephyr-fed widgets (test execution pass rate, test
 *     authoring throughput by sprint)
 *   - PR C: Configurable defect tags + Jira-fed widgets (defects
 *     filed, defect leakage)
 *   - PR D: The full catalog from the QA-Hub spec
 *
 * Layout: a single-row grid for now. As widgets land we'll lay them
 * out in the same bento style the Dev hub uses (see
 * apps/web/src/features/dashboard/dashboard-page.jsx for the
 * canonical reference).
 */

import Link from "next/link";
import { MonoLabel, PageHeader } from "@/components/ui";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { BuildPassRateTile } from "./build-pass-rate-tile";
import { DefectPriorityMixTile } from "./defect-priority-mix-tile";
import { DefectsTile } from "./defects-tile";
import { FlakeRateTile } from "./flake-rate-tile";

export function QaDashboard() {
  const hub = useActiveHub();
  const link = useHubLink();

  return (
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <PageHeader
        crumb={`${hub?.label ?? "QA Hub"} · performance`}
        title="Test quality, on the record."
        italicWord="record"
        subtitle="Automation runs, defect flow, and test coverage — pulled live from Jenkins, Jira, and Zephyr."
        right={
          <Link
            href={link("/settings")}
            className="text-accent hover:underline"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Integrations →
          </Link>
        }
      />

      <div className="mt-2">
        <MonoLabel>01 / Automation health</MonoLabel>
        <div
          className="mt-3 grid gap-3"
          style={{
            gridTemplateColumns: "repeat(12, 1fr)",
            gridAutoRows: "minmax(140px, auto)",
          }}
        >
          <BuildPassRateTile />
          <FlakeRateTile />
        </div>
      </div>

      <div className="mt-8">
        <MonoLabel>02 / Defect flow</MonoLabel>
        <div
          className="mt-3 grid gap-3"
          style={{
            gridTemplateColumns: "repeat(12, 1fr)",
            gridAutoRows: "minmax(140px, auto)",
          }}
        >
          <DefectsTile />
          <DefectPriorityMixTile />
        </div>
      </div>
    </main>
  );
}
