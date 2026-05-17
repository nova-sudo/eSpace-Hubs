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
import { BentoTile } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useIntegrations } from "@/features/integrations";
import { useJiraDefectsForProject } from "@/features/integrations/hooks";

const PROJECT_KEY = "ESPQA";
const WINDOW_DAYS = 14;

// Stable display order + per-priority colour. Colours track the
// emotional weight — red for Highest, yellow for Medium, grey for
// "no priority configured".
const PRIORITY_ORDER = [
  { name: "Highest", color: "var(--bad, #b91c1c)" },
  { name: "High", color: "#dc7e2a" },
  { name: "Medium", color: "var(--warn, #c47b00)" },
  { name: "Low", color: "var(--good, #16a34a)" },
  { name: "Lowest", color: "var(--accent)" },
  { name: "Unset", color: "var(--dim-fg, #9a9a9a)" },
];

export function DefectPriorityMixTile() {
  const { isConnected } = useIntegrations();
  const connected = isConnected("jira");

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      label="Defect priority mix"
      right={connected ? <span style={meta}>last 14d</span> : null}
    >
      {connected ? <Body /> : <NotConnectedBody />}
    </BentoTile>
  );
}

function NotConnectedBody() {
  const link = useHubLink();
  return (
    <div className="flex h-full flex-col justify-between">
      <Headline value="—" muted />
      <div>
        <p className="text-muted-fg" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Connect Jira to see how this sprint&apos;s defects break down by
          priority.
        </p>
        <Link href={link("/settings")} style={ctaLink}>
          Connect Jira →
        </Link>
      </div>
    </div>
  );
}

function Body() {
  const { data, isLoading, error } = useJiraDefectsForProject(
    PROJECT_KEY,
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
        <div style={{ marginTop: 8, ...meta }}>defects by priority</div>
      </div>

      {/* Stacked bar — width proportional to count. Each segment has
          a hover label via title attribute so users can read counts
          off the small slivers. */}
      <div>
        <div
          aria-label="Priority mix bar"
          style={{
            display: "flex",
            width: "100%",
            height: 10,
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid var(--border-strong)",
          }}
        >
          {nonZero.map((b) => (
            <div
              key={b.name}
              title={`${b.name}: ${b.count}`}
              style={{
                flex: `${b.count} 0 0`,
                background: b.color,
              }}
            />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
          {nonZero.map((b) => (
            <Legend key={b.name} {...b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend({ name, color, count }) {
  return (
    <div
      className="flex items-center gap-1.5"
      style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
          display: "inline-block",
        }}
      />
      <span style={{ color: "var(--fg)" }}>{name}</span>
      <span style={{ color: "var(--muted-fg)" }}>{count}</span>
    </div>
  );
}

function Headline({ value, muted }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 64,
        letterSpacing: "-2px",
        lineHeight: 1,
        color: muted ? "var(--muted-fg)" : "var(--fg)",
      }}
    >
      {value}
    </div>
  );
}

function Body0({ head, sub, muted }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <Headline value={head} muted={muted} />
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted-fg)" }}>
        {sub}
      </div>
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
  return PRIORITY_ORDER.map(({ name, color }) => ({
    name,
    color,
    count: counts.get(name) ?? 0,
  }));
}

const meta = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--muted-fg)",
  letterSpacing: "0.4px",
  textTransform: "uppercase",
};
const ctaLink = {
  display: "inline-block",
  marginTop: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: "var(--accent)",
  textDecoration: "none",
};
