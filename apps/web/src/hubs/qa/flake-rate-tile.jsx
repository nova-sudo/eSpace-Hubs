"use client";

/**
 * Flake-rate tile — surfaces how often the regression suite goes
 * yellow without a "real" failure. Computed from build-level
 * Jenkins results in the last 30 days for the qa-sim-target job:
 *
 *   flake-rate = UNSTABLE builds / (SUCCESS + FAILURE + UNSTABLE)
 *
 * Why build-level not test-level:
 *
 *   "True" flake-rate is test-level — a specific test that passes
 *   sometimes, fails other times on the same code. Computing that
 *   requires walking JUnit results per build and diffing test
 *   outcomes across runs, which we don't have wired yet (Jenkins
 *   exposes per-build test results at /testReport/api/json, but
 *   correlating across builds requires fetching every one and
 *   building a test-name index — heavy for a widget).
 *
 *   Build-level UNSTABLE is a strong proxy: Jenkins marks a build
 *   UNSTABLE specifically when JUnit reports a partial failure
 *   (some passed, some failed) — exactly the signal "the suite is
 *   flaky." A FAILURE typically means the build couldn't even run
 *   (infra issue, syntax error). So:
 *
 *     - SUCCESS  → clean green
 *     - FAILURE  → build broken (NOT flake — could be intentional)
 *     - UNSTABLE → tests failed during a successful build (flake!)
 *     - ABORTED  → manual cancel; excluded
 *
 *   This proxy will under-count test-level flakes that happen
 *   alongside a real failure (the build goes FAILURE, masking the
 *   flake). Good enough for now; we promote to test-level in PR D
 *   when we wire JUnit-per-build fetching.
 *
 * The headline number degrades gracefully:
 *   - Jenkins not connected → "—" + Connect Jenkins link
 *   - No completed builds in window → "—" + "no recent builds" copy
 *   - <5 completed builds → number shown, "low signal" subtitle
 *   - >=5 builds → headline with comparison spark
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, BentoTile, Label } from "@/components/ui";
import { useHubLink, useQaHubConfig } from "@/features/hubs";
import { useIntegrations } from "@/features/integrations";
import { useJenkinsBuildsForJob } from "@/features/integrations/hooks";

// Job name comes from useQaHubConfig (QA Hub → Settings → QA Hub
// config). Defaults to "qa-sim-target" — the synthetic CI target we
// ship for the demo flow. BuildPassRateTile prefers the same value
// when auto-selecting a job.
const WINDOW_DAYS = 30;
const LOW_SIGNAL_THRESHOLD = 5;

export function FlakeRateTile() {
  const { isConnected } = useIntegrations();
  const { config } = useQaHubConfig();
  const connected = isConnected("jenkins");
  const jobName = config.jenkinsJobName;
  // #239: the default job is the synthetic demo target — numbers from
  // it must never read as the team's real flake rate. Anything the user
  // explicitly configured is real.
  const isDemoJob = jobName === "qa-sim-target";

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      label={isDemoJob ? "Flake rate · demo data" : "Flake rate · last 30d"}
      right={
        connected ? (
          <Label
            title={
              isDemoJob
                ? "Reading the synthetic qa-sim-target job. Pick your real Jenkins job in Settings → QA Hub config."
                : undefined
            }
          >
            {isDemoJob ? "qa-sim-target · demo" : "unstable / completed"}
          </Label>
        ) : null
      }
    >
      {connected ? <Body jobName={jobName} /> : <NotConnectedBody />}
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
          Connect Jenkins to see how often the suite goes yellow without a
          real failure.
        </p>
        <Link href={link("/settings")} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold text-fg">
          Connect Jenkins <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function Body({ jobName }) {
  const { builds, isLoading, error } = useJenkinsBuildsForJob(jobName);
  const stats = useMemo(() => compute(builds, WINDOW_DAYS), [builds]);

  if (error) {
    return <Body0 head="!" sub="Couldn't load builds for this job." />;
  }
  if (isLoading) {
    return <Body0 head="…" sub="Loading builds…" />;
  }
  if (stats.completed === 0) {
    return <Body0 head="—" sub="No completed builds in the last 30 days." />;
  }

  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <Headline value={`${Math.round(stats.flakeRate * 100)}%`} />
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-fg">
          <Badge tone="lemon">{stats.unstable} unstable</Badge>
          <span>/ {stats.completed} completed</span>
        </div>
      </div>
      <div>
        <Label>Suite</Label>
        <div className="mt-1.5 font-mono text-[12px]">{jobName}</div>
        {stats.completed < LOW_SIGNAL_THRESHOLD ? (
          <div className="mt-2 text-[11px] text-dim-fg">
            Low signal — fewer than {LOW_SIGNAL_THRESHOLD} builds in window
          </div>
        ) : null}
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

function Body0({ head, sub }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <Headline value={head} muted />
      <div className="text-[12.5px] leading-[1.5] text-muted-fg">{sub}</div>
    </div>
  );
}

/**
 * Walk the build list and count by result, restricted to the window.
 * Returns { unstable, failure, success, aborted, completed, flakeRate }.
 */
function compute(builds, windowDays) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  let unstable = 0;
  let failure = 0;
  let success = 0;
  let aborted = 0;
  for (const b of builds) {
    if (typeof b.timestamp !== "number" || b.timestamp < cutoff) continue;
    if (b.building) continue;
    switch (b.result) {
      case "SUCCESS":
        success++;
        break;
      case "FAILURE":
        failure++;
        break;
      case "UNSTABLE":
        unstable++;
        break;
      case "ABORTED":
        aborted++;
        break;
      default:
        // null / unknown — skip
        break;
    }
  }
  // Definition: flake rate = unstable / (success + failure + unstable).
  // ABORTED excluded because cancels aren't a quality signal.
  const denom = success + failure + unstable;
  const flakeRate = denom === 0 ? 0 : unstable / denom;
  return { unstable, failure, success, aborted, completed: denom, flakeRate };
}
