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
 * out in the same bento style the Dev hub uses.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader, Section } from "@/components/ui";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { BuildPassRateTile } from "./build-pass-rate-tile";
import { DefectPriorityMixTile } from "./defect-priority-mix-tile";
import { DefectsTile } from "./defects-tile";
import { FlakeRateTile } from "./flake-rate-tile";

export function QaDashboard() {
  const hub = useActiveHub();
  const link = useHubLink();

  return (
    <main className="max-w-[1280px] mx-auto px-4 sm:px-10 pb-16 pt-7">
      <PageHeader
        crumb={`${hub?.label ?? "QA Hub"} · performance`}
        title="Test quality, on the record."
        subtitle="Automation runs and defect flow — pulled live from Jenkins and Jira."
        right={
          <Link href={link("/settings")} className="flex items-center gap-1.5 text-[12.5px] font-bold text-fg">
            Integrations <ArrowRight size={13} />
          </Link>
        }
      />

      <Section title="Automation health">
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(12, 1fr)",
            gridAutoRows: "minmax(140px, auto)",
          }}
        >
          <BuildPassRateTile />
          <FlakeRateTile />
        </div>
      </Section>

      <Section title="Defect flow">
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(12, 1fr)",
            gridAutoRows: "minmax(140px, auto)",
          }}
        >
          <DefectsTile />
          <DefectPriorityMixTile />
        </div>
      </Section>
    </main>
  );
}
