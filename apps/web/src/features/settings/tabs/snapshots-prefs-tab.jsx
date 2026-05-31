"use client";

import { Button, Card, Field, Input, MonoLabel, Section } from "@/components/ui";
import { clearAutoSnapshots, useBackfill } from "@/features/snapshots";

const EXPLICIT_NOT = [
  [
    "No leaderboard.",
    "Your metrics are never compared to teammates inside this tool. Personal vs. personal baseline only.",
  ],
  [
    "No manager view.",
    "There is no role-based manager dashboard. If that product ever ships, it will be a separate app with separate consent.",
  ],
  [
    "No telemetry.",
    "We don't track which tiles you look at, which tickets you hover, or when you open the app.",
  ],
  [
    "No third-party cookies.",
    "The only cookies we set are a session cookie for the OAuth handshake with GitHub — cleared on disconnect.",
  ],
];

export function SnapshotsPrefsTab() {
  return (
    <>
      <Section num="01 /" title="Cycle history">
        <BackfillCard />
      </Section>
      <Section num="02 /" title="Snapshot schedule">
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-5">
            <Field
              label="Frequency"
              hint="Weekly is recommended. Daily creates noise; monthly misses deltas."
            >
              <Input defaultValue="Weekly · Mondays at 09:00 Africa/Cairo" />
            </Field>
            <Field
              label="Retention"
              hint="How many weeks of history to keep in your browser."
            >
              <Input defaultValue="26 weeks (6 months)" />
            </Field>
          </div>
          <div
            className="mt-2.5 rounded-[var(--radius-sub)] bg-accent-dim px-3.5 py-3 text-[12.5px] leading-[1.5]"
          >
            <strong className="text-accent">Heads up:</strong> snapshots live in your
            browser storage. Clearing site data wipes them. Consider exporting to JSON
            before switching machines.
          </div>
        </Card>
      </Section>
      <Section num="03 /" title="What we explicitly do not do">
        <Card className="p-6">
          {EXPLICIT_NOT.map(([title, body]) => (
            <div
              key={title}
              className="border-b border-border border-dashed py-3.5 last:border-b-0"
            >
              <div
                className="mb-1 font-semibold"
                style={{ fontFamily: "var(--font-display)", fontSize: 15 }}
              >
                {title}
              </div>
              <div className="text-[13px] leading-[1.5] text-muted-fg">{body}</div>
            </div>
          ))}
        </Card>
      </Section>
    </>
  );
}

/**
 * Manual backfill control. The top-of-page BackfillBanner already
 * surfaces this when `missingWeeks > 0`, but the banner self-hides
 * once history is covered (and is easy to dismiss-by-scrolling-past).
 * Settings is a more discoverable home for re-running the synthesis
 * on demand, e.g. after a fresh GitHub reconnect that newly populated
 * the events feed.
 *
 * The button is idempotent: with zero missing weeks the click is a
 * no-op. We disable it explicitly in that state so the user doesn't
 * wonder whether something fired silently.
 */
function BackfillCard() {
  const { run, isRunning, progress, missingWeeks, totalWeeks } = useBackfill();
  const hasMissing = missingWeeks > 0;

  // Reset path — wipes AUTO snapshots so a previous bad backfill (e.g.
  // ran while a data source was returning empty) can be re-synthesised
  // from scratch. Manual snapshots are preserved. The follow-up run()
  // re-enumerates from a freshly-cleared store so every completed week
  // re-enters the work queue. Awaiting the clear avoids racing the
  // delete requests against the re-synthesis POSTs.
  const handleResetAndRebackfill = async () => {
    if (isRunning) return;
    if (
      !window.confirm(
        "Delete all auto-captured snapshots and re-synthesise from your current connected data? Manual snapshots will be preserved.",
      )
    ) {
      return;
    }
    await clearAutoSnapshots();
    void run();
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-6">
        <div className="max-w-[560px]">
          <MonoLabel>
            {hasMissing
              ? `${missingWeeks} week${missingWeeks === 1 ? "" : "s"} missing`
              : `${totalWeeks} week${totalWeeks === 1 ? "" : "s"} tracked`}
          </MonoLabel>
          <div
            className="mt-2 font-semibold"
            style={{ fontFamily: "var(--font-display)", fontSize: 17 }}
          >
            Synthesise weekly snapshots from connected data
          </div>
          <p className="mt-2 text-[13px] leading-[1.55] text-muted-fg">
            Recomputes <em>every</em> completed Sun → Thu week of the current
            year from your currently-connected providers and overwrites the
            saved numbers in place — so a week captured while a provider was
            unreachable (or before an integration fix landed) gets refreshed,
            not skipped. Merged count, turnaround, linkage and review rounds
            are PR-derived and fill for the full year. Weeks older than ~90
            days stay <em>partial</em> because the GitHub events feed only
            reaches that far back — reviews-given for those weeks reads as 0,
            flagged as unavailable rather than zero-effort.
          </p>
          <p className="mt-2 text-[12px] leading-[1.5] text-dim-fg">
            Your hand-typed notes are preserved. <span className="text-fg">Reset
            &amp; re-backfill</span> additionally deletes auto-captured
            snapshots first (manual ones are kept) for a clean re-synthesis.
          </p>
          {isRunning && progress ? (
            <div
              className="mt-3 inline-flex items-center gap-2 text-[12px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <span className="block h-[6px] w-[6px] animate-pulse rounded-full bg-accent" />
              Building week {progress.done} of {progress.total}…
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <Button
            onClick={() => run()}
            disabled={isRunning || totalWeeks === 0}
            title={
              totalWeeks === 0
                ? "No completed weeks yet this year."
                : "Recompute and overwrite every completed week from live data."
            }
          >
            {isRunning ? "Running…" : "Backfill now"}
          </Button>
          <Button
            variant="ghost"
            onClick={handleResetAndRebackfill}
            disabled={isRunning}
          >
            Reset &amp; re-backfill
          </Button>
        </div>
      </div>
    </Card>
  );
}
