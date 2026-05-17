"use client";

/**
 * Defects · last 14 days — a count of every Jira Bug filed in the
 * configured QA project over the past two weeks (rolling).
 *
 * Why 14 days and not "current sprint":
 *
 *   Querying "the sprint" requires `sprint in openSprints()` in JQL,
 *   which only returns issues when the project has an active sprint
 *   started — and a brand-new Scrum project sits with sprint backlog
 *   only until someone clicks "Start sprint". For the simulation
 *   target that's fragile.
 *
 *   A 14-day rolling window approximates a typical sprint length on
 *   most teams and works regardless of sprint state. A "Sprint
 *   cadence" setting (PR D / PR E) can switch this to true sprint
 *   bounds when configured.
 *
 * Project key comes from useQaHubConfig (QA Hub → Settings → QA Hub
 * config). Defaults to ESPQA; users with a different Jira project
 * change it once and both this tile and DefectPriorityMixTile pick
 * it up (they share the same SWR cache key, so the two tiles still
 * cost one Jira call together).
 */

import Link from "next/link";
import { BentoTile } from "@/components/ui";
import { useHubLink, useQaHubConfig } from "@/features/hubs";
import { useIntegrations } from "@/features/integrations";
import { useJiraDefectsForProject } from "@/features/integrations/hooks";

const WINDOW_DAYS = 14;

export function DefectsTile() {
  const { isConnected } = useIntegrations();
  const { config } = useQaHubConfig();
  const connected = isConnected("jira");
  const projectKey = config.jiraProjectKey;

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      label="Defects · last 14d"
      right={connected ? <span style={meta}>{projectKey}</span> : null}
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
        <p className="text-muted-fg" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Connect Jira to see how many bugs your team has logged this sprint.
        </p>
        <Link href={link("/settings")} style={ctaLink}>
          Connect Jira →
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
  const issues = Array.isArray(data?.issues) ? data.issues : [];

  if (error) {
    // Jira project-not-found returns 400/404 with a clear message; we
    // surface a short version so the user knows what to do.
    const isProjectMissing =
      /project/i.test(error.message || "") || error.status === 400;
    return (
      <Body0
        head="!"
        sub={
          isProjectMissing
            ? `Couldn't find project ${projectKey} in your Jira. Create it, or change the project key in QA Hub config.`
            : `Couldn't load defects: ${error.code ?? error.status ?? "error"}`
        }
      />
    );
  }
  if (isLoading) return <Body0 head="…" sub="Loading defects…" />;

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <Headline value={issues.length} />
        <div style={{ marginTop: 8, ...meta }}>
          {issues.length === 1 ? "bug" : "bugs"} logged in the last {WINDOW_DAYS} days
        </div>
      </div>
      {issues.length > 0 ? (
        <div>
          <div style={{ ...meta, marginBottom: 6 }}>Most recent</div>
          <div className="flex flex-col gap-1">
            {issues.slice(0, 3).map((it) => (
              <RecentItem key={it.key} issue={it} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--muted-fg)" }}>
          No bugs in the window. Either things are calm, or nobody&apos;s logged
          one yet.
        </div>
      )}
    </div>
  );
}

function RecentItem({ issue }) {
  const summary = issue?.fields?.summary || "(no summary)";
  const priority = issue?.fields?.priority?.name || "—";
  return (
    <div
      className="flex items-center gap-2 border-b border-dashed border-border pb-1 last:border-b-0 last:pb-0"
      style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
    >
      <span
        className="font-semibold text-accent"
        style={{ letterSpacing: "0.2px" }}
      >
        {issue.key}
      </span>
      <span className="flex-1 truncate" style={{ color: "var(--fg)" }}>
        {summary}
      </span>
      <span
        style={{
          fontSize: 9.5,
          letterSpacing: "0.3px",
          color: "var(--muted-fg)",
        }}
      >
        {priority}
      </span>
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

function Body0({ head, sub }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <Headline value={head} muted />
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted-fg)" }}>
        {sub}
      </div>
    </div>
  );
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
