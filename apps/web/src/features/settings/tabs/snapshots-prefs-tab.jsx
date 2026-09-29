"use client";

import { Button, Card, Label, Section } from "@/components/ui";
import { clearAutoSnapshots, useBackfill } from "@/features/snapshots";
import { useIntegrations } from "@/features/integrations";

/**
 * Keep this list TRUE. It's the privacy contract a user reads before
 * deciding what to type in. Facts, as of the current backend:
 *   - Managers with the Manager hub can read their reports' goal
 *     health, goal detail (readings, evidence, verdicts) and review
 *     packets — apps/api/src/modules/manager/routes.ts, gated by the
 *     MANAGER_TEAM_VIEW capability and the managerId link.
 *   - Snapshots, goals, readings and grades are server-side per account.
 *   - The only cookie is the eSpace Hubs session cookie.
 */
const HONEST_LIST = [
  [
    "No leaderboard.",
    "Your metrics are never ranked against teammates inside this tool. Comparisons are you vs. your own baseline.",
  ],
  [
    "Your manager can see your board — nothing else can.",
    "If an admin has linked you to a manager, that manager (and only that manager) can read your goal health, goal detail and review packets from the Manager hub. There is no org-wide dashboard and no export of your data to HR systems.",
  ],
  [
    "No usage telemetry.",
    "We don't track which tiles you look at, which tickets you hover, or when you open the app. Server logs record request outcomes for debugging, never your goal text.",
  ],
  [
    "One cookie.",
    "The only cookie we set is your eSpace Hubs session cookie. There are no third-party or advertising cookies; the GitHub sign-in uses a short-lived, browser-only state value.",
  ],
];

const SCHEDULE = [
  ["Frequency", "Weekly — the server freezes last week for you if you didn't visit (manual trackers only); a visit captures the full picture."],
  ["Retention", "The whole performance cycle (calendar year). Past cycles are archived as read-only report cards."],
  ["Where it lives", "In your account on our server — it follows you across devices and survives clearing this browser."],
];

export function SnapshotsPrefsTab({ onSwitchTab }) {
  return (
    <div className="flex flex-col gap-8">
      <Section title="Cycle history">
        <BackfillCard onSwitchTab={onSwitchTab} />
      </Section>
      <Section title="Snapshot schedule">
        <Card className="p-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SCHEDULE.map(([term, detail]) => (
              <div key={term}>
                <dt>
                  <Label>{term}</Label>
                </dt>
                <dd className="mt-1 text-[13px] leading-[1.5] text-fg">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12px] leading-[1.5] text-muted-fg">
            The schedule isn&apos;t configurable per user — it&apos;s what makes
            week-over-week trends comparable across the team.
          </p>
        </Card>
      </Section>
      <Section title="What we do and don't do with your data">
        <Card className="p-6">
          {HONEST_LIST.map(([title, body]) => (
            <div key={title} className="border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
              <div className="mb-1 text-[15px] font-bold text-fg">{title}</div>
              <div className="text-[13px] leading-[1.5] text-muted-fg">{body}</div>
            </div>
          ))}
        </Card>
      </Section>
    </div>
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
function BackfillCard({ onSwitchTab }) {
  const { run, isRunning, progress, missingWeeks, totalWeeks } = useBackfill();
  const hasMissing = missingWeeks > 0;
  // Backfill synthesises PR-derived weeks — with no code host connected it
  // can only overwrite history with zeros, so it waits for one.
  const { isConnected } = useIntegrations();
  const hasCodeHost = isConnected("github") || isConnected("gitlab");

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
          <Label>
            {hasMissing
              ? `${missingWeeks} week${missingWeeks === 1 ? "" : "s"} missing`
              : `${totalWeeks} week${totalWeeks === 1 ? "" : "s"} tracked`}
          </Label>
          <div className="mt-2 text-[17px] font-bold text-fg">
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
          <p className="mt-2 text-[12px] leading-[1.5] text-muted-fg">
            Your hand-typed notes are preserved. <span className="text-fg font-semibold">Reset
            &amp; re-backfill</span> additionally deletes auto-captured
            snapshots first (manual ones are kept) for a clean re-synthesis.
          </p>
          {isRunning && progress ? (
            <div className="mt-3 inline-flex items-center gap-2 text-[12px] text-muted-fg">
              <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />
              Building week {progress.done} of {progress.total}…
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <Button
            onClick={() => run()}
            disabled={isRunning || totalWeeks === 0 || !hasCodeHost}
            aria-describedby={!hasCodeHost ? "backfill-needs-host" : undefined}
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
            disabled={isRunning || !hasCodeHost}
          >
            Reset &amp; re-backfill
          </Button>
          {!hasCodeHost ? (
            <p id="backfill-needs-host" className="max-w-[200px] text-[12px] leading-[1.45] text-muted-fg">
              Connect GitHub or GitLab first.{" "}
              <button
                type="button"
                onClick={() => onSwitchTab?.("integrations")}
                className="link-target font-semibold text-fg underline"
              >
                Open Integrations
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
