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
import { BentoTile, MonoLabel, PageHeader } from "@/components/ui";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { BuildPassRateTile } from "./build-pass-rate-tile";

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
        <MonoLabel>01 / Automation</MonoLabel>
        <div
          className="mt-3 grid gap-3"
          style={{
            gridTemplateColumns: "repeat(12, 1fr)",
            gridAutoRows: "minmax(140px, auto)",
          }}
        >
          <BuildPassRateTile />
          <ComingSoonTile
            col="span 4"
            label="Flake rate · last 30d"
            body="Tests that flip pass↔fail between runs without a code change. Lands in PR B alongside the broader Jenkins panel."
          />
          <ComingSoonTile
            col="span 4"
            label="Defects logged · current sprint"
            body="Bugs you raised in Jira this sprint, by severity. Lands in PR C once defect-tag config is wired."
          />
        </div>
      </div>
    </main>
  );
}

/**
 * Inline "this widget hasn't shipped yet" tile. We DO render this
 * (rather than hiding the slot entirely) so the QA dashboard has
 * shape from day one — a half-empty grid is more legible than
 * staring at one tile floating alone.
 */
function ComingSoonTile({ col = "span 4", label, body }) {
  return (
    <BentoTile col={col} row="span 1" label={label}>
      <div
        className="flex h-full flex-col justify-between"
        style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 36,
            color: "var(--muted-fg)",
            letterSpacing: "-1px",
          }}
        >
          —
        </div>
        <div className="text-[12px] leading-[1.5] text-muted-fg">{body}</div>
        <div
          className="text-dim-fg"
          style={{ fontSize: 10, letterSpacing: "0.5px" }}
        >
          coming soon
        </div>
      </div>
    </BentoTile>
  );
}
