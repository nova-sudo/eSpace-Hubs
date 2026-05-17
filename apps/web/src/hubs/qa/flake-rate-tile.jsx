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
 *   - Jenkins not connected → "—" + Connect Jenkins → link
 *   - No completed builds in window → "—" + "no recent builds" copy
 *   - <5 completed builds → number shown, "low signal" subtitle
 *   - >=5 builds → headline with comparison spark
 */

import { useMemo } from "react";
import Link from "next/link";
import { BentoTile } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useIntegrations } from "@/features/integrations";
import { useJenkinsBuildsForJob } from "@/features/integrations/hooks";

// Same job name the BuildPassRateTile uses by default. Both tiles
// will eventually accept a selector when we ship the "configure
// which job per widget" UI in PR D.
const JOB_NAME = "qa-sim-target";
const WINDOW_DAYS = 30;
const LOW_SIGNAL_THRESHOLD = 5;

export function FlakeRateTile() {
  const { isConnected } = useIntegrations();
  const connected = isConnected("jenkins");

  return (
    <BentoTile
      col="span 4"
      row="span 2"
      label="Flake rate · last 30d"
      right={connected ? <span style={meta}>UNSTABLE / completed</span> : null}
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
          Connect Jenkins to see how often the suite goes yellow without a
          real failure.
        </p>
        <Link href={link("/settings")} style={ctaLink}>
          Connect Jenkins →
        </Link>
      </div>
    </div>
  );
}

function Body() {
  const { builds, isLoading, error } = useJenkinsBuildsForJob(JOB_NAME);
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
        <div style={breakdown}>
          <span style={{ color: "var(--warn, #c47b00)" }}>
            {stats.unstable} unstable
          </span>{" "}
          / {stats.completed} completed
        </div>
      </div>
      <div>
        <div style={{ ...meta, marginBottom: 6 }}>SUITE</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
          {JOB_NAME}
        </div>
        {stats.completed < LOW_SIGNAL_THRESHOLD ? (
          <div className="mt-2" style={lowSignal}>
            Low signal — fewer than {LOW_SIGNAL_THRESHOLD} builds in window
          </div>
        ) : null}
      </div>
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

// ─── styles (mono pixels are stable across re-renders, no css var lookup
//      cost in the tile body) ───
const meta = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--muted-fg)",
  letterSpacing: "0.4px",
  textTransform: "uppercase",
};
const breakdown = {
  marginTop: 8,
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  color: "var(--muted-fg)",
};
const lowSignal = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  color: "var(--dim-fg)",
  letterSpacing: "0.2px",
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
