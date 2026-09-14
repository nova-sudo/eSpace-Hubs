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
import { ArrowRight } from "lucide-react";
import { BentoTile, Label } from "@/components/ui";
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
      right={connected ? <Label>{projectKey}</Label> : null}
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
          Connect Jira to see how many bugs your team has logged this sprint.
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
        <div className="mt-2">
          <Label>
            {issues.length === 1 ? "bug" : "bugs"} logged in the last {WINDOW_DAYS} days
          </Label>
        </div>
      </div>
      {issues.length > 0 ? (
        <div>
          <div className="mb-1.5">
            <Label>Most recent</Label>
          </div>
          <div className="flex flex-col gap-1">
            {issues.slice(0, 3).map((it) => (
              <RecentItem key={it.key} issue={it} />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-muted-fg">
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
    <div className="flex items-center gap-2 border-t border-line pt-1 first:border-t-0 first:pt-0 text-[11px]">
      <span className="font-mono font-semibold text-fg">{issue.key}</span>
      <span className="flex-1 truncate text-fg">{summary}</span>
      <span className="text-[11px] text-muted-fg">{priority}</span>
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

function Body0({ head, sub }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <Headline value={head} muted />
      <div className="text-[12.5px] leading-[1.5] text-muted-fg">{sub}</div>
    </div>
  );
}
