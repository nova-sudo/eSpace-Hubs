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
 *   most teams and works regardless of sprint state. PR C will add
 *   a "Sprint cadence" setting so this can switch to true sprint
 *   bounds when configured.
 *
 * Project key is hard-coded to ESPQA — same caveat as the
 * BuildPassRate's job name. PR C makes it a per-org setting.
 *
 * The headline is just a count. The companion DefectPriorityMixTile
 * (next file) breaks the same data down by priority. Sharing one
 * Jira query between the two tiles means we only make one network
 * call per dashboard load (SWR dedupes on the cache key).
 */

import Link from "next/link";
import { BentoTile } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useIntegrations } from "@/features/integrations";
import { useJiraDefectsForProject } from "@/features/integrations/hooks";

// Hard-coded for now; PR C surfaces this in QA Hub config.
const PROJECT_KEY = "ESPQA";
const WINDOW_DAYS = 14;

export function DefectsTile() {
  const { isConnected } = useIntegrations();
  const connected = isConnected("jira");

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      label="Defects · last 14d"
      right={
        connected ? (
          <span style={meta}>{PROJECT_KEY}</span>
        ) : null
      }
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
          Connect Jira to see how many bugs your team has logged this sprint.
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
            ? `Couldn't find project ${PROJECT_KEY} in your Jira. Create it or adjust the QA Hub config.`
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
