"use client";

/**
 * Defect priority mix — same Jira data as <DefectsTile>, different
 * cut: stacked bars showing how many bugs of each priority are open
 * in the window. Shares SWR cache key with <DefectsTile> so the two
 * tiles only cost one Jira call together.
 *
 * Priority order matches Jira's default scheme:
 *   Highest > High > Medium > Low > Lowest
 *
 * If a ticket has no priority field (rare but possible on projects
 * with custom workflows) we bucket it under "Unset". Skipping such
 * rows would hide them; bucketing surfaces "configure your project"
 * as an implicit signal.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, BentoTile, Label } from "@/components/ui";
import { useHubLink, useQaHubConfig } from "@/features/hubs";
import { useIntegrations } from "@/features/integrations";
import { useJiraDefectsForProject } from "@/features/integrations/hooks";

const WINDOW_DAYS = 14;

// Stable display order, highest → lowest, each mapped to a design
// tint. `tone` drives both the bar segment and the legend Badge.
const PRIORITY_ORDER = [
  { name: "Highest", tone: "lav" },
  { name: "High", tone: "sky" },
  { name: "Medium", tone: "lemon" },
  { name: "Low", tone: "peach" },
  { name: "Lowest", tone: "neutral" },
  { name: "Unset", tone: "neutral" },
];

const BAR_CLASS = {
  lav: "bg-lav",
  sky: "bg-sky",
  lemon: "bg-lemon",
  peach: "bg-peach",
  neutral: "bg-card-alt",
};

export function DefectPriorityMixTile() {
  const { isConnected } = useIntegrations();
  const { config } = useQaHubConfig();
  const connected = isConnected("jira");
  const projectKey = config.jiraProjectKey;

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      label="Defect priority mix"
      right={connected ? <Label>last 14d</Label> : null}
    >
      {connected ? <Body projectKey={projectKey} /> : <NotConnectedBody />}
    </BentoTile>
  );
}

function NotConnectedBody() {
  const link = useHubLink();
  return (
    <div className="flex h-full flex-col justify-between">
      <Headline value="—" muted />
      <div>
        <p className="text-[12.5px] leading-[1.5] text-muted-fg">
          Connect Jira to see how this sprint&apos;s defects break down by
          priority.
        </p>
        <Link href={link("/settings")} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold text-fg">
          Connect Jira <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function Body({ projectKey }) {
  const { data, isLoading, error } = useJiraDefectsForProject(
    projectKey,
    WINDOW_DAYS,
  );
  const buckets = useMemo(() => bucketByPriority(data?.issues ?? []), [data]);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  if (error) {
    return <Body0 head="!" sub="Couldn't load defects." />;
  }
  if (isLoading) return <Body0 head="…" sub="Loading priority mix…" />;
  if (total === 0) {
    return <Body0 head="—" sub="No bugs in the window — no mix to show." muted />;
  }

  // Only render non-zero priorities — keeps the bar visually honest.
  const nonZero = buckets.filter((b) => b.count > 0);

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <Headline value={total} />
        <div className="mt-2">
          <Label>defects by priority</Label>
        </div>
      </div>

      {/* Stacked bar — width proportional to count. Each segment has
          a hover label via title attribute so users can read counts
          off the small slivers. */}
      <div>
        <div aria-label="Priority mix bar" className="flex h-2.5 w-full overflow-hidden rounded-[var(--radius-pill)]">
          {nonZero.map((b) => (
            <div
              key={b.name}
              title={`${b.name}: ${b.count}`}
              className={BAR_CLASS[b.tone]}
              style={{ flex: `${b.count} 0 0` }}
            />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {nonZero.map((b) => (
            <Badge key={b.name} tone={b.tone}>
              {b.name} · {b.count}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function Headline({ value, muted }) {
  return (
    <div className={`text-[56px] font-extrabold leading-none tracking-[-0.04em] tabular-nums ${muted ? "text-dim-fg" : "text-fg"}`}>
      {value}
    </div>
  );
}

function Body0({ head, sub, muted }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <Headline value={head} muted={muted} />
      <div className="text-[12.5px] leading-[1.5] text-muted-fg">{sub}</div>
    </div>
  );
}

function bucketByPriority(issues) {
  const counts = new Map(PRIORITY_ORDER.map((p) => [p.name, 0]));
  for (const it of issues) {
    const name = it?.fields?.priority?.name || "Unset";
    if (counts.has(name)) counts.set(name, counts.get(name) + 1);
    else counts.set("Unset", (counts.get("Unset") ?? 0) + 1);
  }
  return PRIORITY_ORDER.map(({ name, tone }) => ({
    name,
    tone,
    count: counts.get(name) ?? 0,
  }));
}
