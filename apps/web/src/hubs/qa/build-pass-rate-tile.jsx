"use client";

/**
 * Build pass-rate tile — QA Hub headline metric. Reads Jenkins build
 * history for ONE selected job and shows:
 *
 *   - Headline %     pass rate over the last ~30 days of builds
 *                    (SUCCESS / total non-in-flight)
 *   - Counts         passed · failed · unstable · aborted
 *   - Last 5 builds  colored dots, newest on the right
 *   - Job picker     dropdown when the user has > 1 job
 *
 * The tile gracefully degrades when Jenkins isn't connected — shows
 * a "Connect from Settings" link instead of an error. The QA hub
 * stays useful even before any QA-specific integrations land.
 *
 * Why pass-rate over total-count: a high build count tells you about
 * suite cadence (good signal for "is CI integrated?"), but pass-rate
 * tells you about suite quality. The QA L2 "Integrate tests with CI/
 * CD pipelines" needs both — for THIS tile we pick pass-rate as the
 * single headline number and surface counts beneath. A separate
 * "build cadence" tile lands in PR D.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, BentoTile, Label, Select } from "@/components/ui";
import { useHubLink, useQaHubConfig } from "@/features/hubs";
import { useIntegrations } from "@/features/integrations";
import {
  useJenkinsJobs,
  useJenkinsBuildsForJob,
} from "@/features/integrations/hooks";

const WINDOW_DAYS = 30;

export function BuildPassRateTile() {
  const { isConnected } = useIntegrations();
  const connected = isConnected("jenkins");

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      label="Build pass rate · last 30d"
      right={connected ? <Label>last {WINDOW_DAYS}d</Label> : null}
    >
      {connected ? <ConnectedBody /> : <NotConnectedBody />}
    </BentoTile>
  );
}

function NotConnectedBody() {
  const link = useHubLink();
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="text-[56px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-dim-fg">
        —
      </div>
      <div>
        <div className="text-[12.5px] leading-[1.5] text-muted-fg">
          Connect Jenkins to see your suite's pass rate, flake
          tendencies, and slowest tests.
        </div>
        <Link href={link("/settings")} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold text-fg">
          Connect Jenkins <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function ConnectedBody() {
  const { jobs, isLoading: jobsLoading, error: jobsError } = useJenkinsJobs();
  const { config } = useQaHubConfig();
  const [selectedJob, setSelectedJob] = useState(null);

  // Default selection priority:
  //   1) the job the user picked in QA Hub config (jenkinsJobName)
  //   2) the first buildable job
  //   3) the first job in the list
  // The user can still pick a different job via the dropdown — this
  // is just the initial selection. Re-runs when the config job name
  // changes so a fresh save in another tab seeds the right default.
  useEffect(() => {
    if (selectedJob || jobs.length === 0) return;
    const preferred = config.jenkinsJobName
      ? jobs.find((j) => j.name === config.jenkinsJobName)
      : null;
    if (preferred) {
      setSelectedJob(preferred.name);
      return;
    }
    const firstBuildable = jobs.find((j) => j.buildable) ?? jobs[0];
    setSelectedJob(firstBuildable.name);
  }, [jobs, selectedJob, config.jenkinsJobName]);

  if (jobsError) {
    return (
      <Body
        headline="!"
        sub="Couldn't reach Jenkins. Check the integration in Settings."
        muted
      />
    );
  }
  if (jobsLoading) {
    return <Body headline="…" sub="Loading job list…" muted />;
  }
  if (jobs.length === 0) {
    return (
      <Body
        headline="0"
        sub="No buildable jobs visible to your token. Make sure your Jenkins user has at least Job/Read."
        muted
      />
    );
  }

  return <JobView jobs={jobs} selected={selectedJob} onSelect={setSelectedJob} />;
}

function JobView({ jobs, selected, onSelect }) {
  const { builds, isLoading, error } = useJenkinsBuildsForJob(selected);

  const stats = useMemo(() => computeStats(builds, WINDOW_DAYS), [builds]);

  if (error) {
    return (
      <Body
        headline="!"
        sub="Couldn't load builds for this job."
        muted
      />
    );
  }

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <JobPicker jobs={jobs} selected={selected} onSelect={onSelect} />
        <div className="mt-2 flex items-baseline gap-3">
          <div
            className={`text-[56px] font-extrabold leading-none tracking-[-0.04em] tabular-nums ${
              stats.completed === 0 ? "text-dim-fg" : "text-fg"
            }`}
          >
            {isLoading
              ? "…"
              : stats.completed === 0
                ? "—"
                : `${Math.round(stats.passRate * 100)}%`}
          </div>
          {stats.completed > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="mint">{stats.passed} passed</Badge>
              {stats.failed > 0 ? <Badge tone="peach">{stats.failed} failed</Badge> : null}
              {stats.unstable > 0 ? <Badge tone="lemon">{stats.unstable} unstable</Badge> : null}
              {stats.aborted > 0 ? <Badge>{stats.aborted} aborted</Badge> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <Label>Recent</Label>
        <BuildPills builds={stats.recent} />
      </div>
    </div>
  );
}

function JobPicker({ jobs, selected, onSelect }) {
  if (jobs.length <= 1) {
    return <div className="text-[11px] text-muted-fg">{selected ?? jobs[0]?.name ?? "—"}</div>;
  }
  return (
    <Select size="sm" value={selected ?? ""} onChange={(e) => onSelect(e.target.value)} className="max-w-full">
      {jobs.map((j) => (
        <option key={j.name} value={j.name}>
          {j.name}
        </option>
      ))}
    </Select>
  );
}

function BuildPills({ builds }) {
  if (builds.length === 0) {
    return <div className="mt-1.5 text-[11px] text-muted-fg">No builds in window.</div>;
  }
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      {builds.map((b) => (
        <span
          key={b.number}
          title={`#${b.number} · ${b.result ?? "in flight"}`}
          className={`inline-block h-3 w-3 rounded-[3px] ${pillClass(b.result)}`}
        />
      ))}
    </div>
  );
}

function pillClass(result) {
  switch (result) {
    case "SUCCESS":
      return "bg-mint";
    case "FAILURE":
      return "bg-peach";
    case "UNSTABLE":
      return "bg-lemon";
    case "ABORTED":
      return "bg-card-alt";
    default:
      return "bg-transparent";
  }
}

function Body({ headline, sub, muted }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className={`text-[56px] font-extrabold leading-none tracking-[-0.04em] ${muted ? "text-dim-fg" : "text-fg"}`}>
        {headline}
      </div>
      <div className="text-[12.5px] leading-[1.5] text-muted-fg">{sub}</div>
    </div>
  );
}

/**
 * Compute the headline stats. `builds` is what Jenkins returns under
 * `builds[]` — already trimmed by the api-client's `{,100}` selector.
 *
 * Rules:
 *   - in-flight builds (result === null && building === true) excluded
 *     from completed totals
 *   - pass rate = SUCCESS / (SUCCESS + FAILURE + UNSTABLE + ABORTED)
 *   - "recent" = last 5 completed builds, newest LAST so the pills
 *     read left-to-right in chronological order
 *
 * UNSTABLE counts as a non-pass for the headline rate — when a build
 * is yellow, something flagged it (tests failed even though the build
 * completed). A QA dashboard that lumps unstable in with pass would
 * hide the very signal QA cares about.
 */
function computeStats(builds, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = builds.filter(
    (b) => typeof b.timestamp === "number" && b.timestamp >= cutoff,
  );

  let passed = 0;
  let failed = 0;
  let unstable = 0;
  let aborted = 0;
  let completed = 0;
  for (const b of inWindow) {
    if (b.building) continue;
    if (b.result === "SUCCESS") {
      passed++;
      completed++;
    } else if (b.result === "FAILURE") {
      failed++;
      completed++;
    } else if (b.result === "UNSTABLE") {
      unstable++;
      completed++;
    } else if (b.result === "ABORTED") {
      aborted++;
      completed++;
    }
  }
  const passRate = completed === 0 ? 0 : passed / completed;
  // Jenkins returns newest-first; reverse the last 5 to read left→right.
  const recent = inWindow
    .filter((b) => !b.building)
    .slice(0, 5)
    .reverse();

  return { passed, failed, unstable, aborted, completed, passRate, recent };
}
