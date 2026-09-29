"use client";

/**
 * The manager dashboard's overview strip, above the roster:
 *
 *   Grading progress  "Graded 4 of 11 goals for 2026" — your grades in
 *                     this year's period, with disputes; opens the
 *                     team page's Calibration view
 *   My goals          where a manager tracks their OWN goals: the dev
 *                     hub if they can reach it, else what to ask for
 *   Team trend        one sparkline per report — merged PRs per week
 *                     from their weekly snapshots
 *
 * Data: GET /manager/grading-progress, /manager/team-trends,
 * /hubs/me (via useAvailableHubs).
 */

import Link from "next/link";
import { Button, Card, Label, Sparkline } from "@/components/ui";
import { useAvailableHubs } from "@/features/hubs";
import { MiniBar } from "./manager-ui";
import { percent, plural } from "./manager-format";
import { useGradingProgress } from "./use-grading-progress";
import { useTeamTrends } from "./use-team-trends";
import { latestWeekLine, mergedSeries } from "./trend-format";

export function ManagerOverview({ onCalibrate }) {
  return (
    <div className="mb-6 grid gap-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <GradingProgressCard onCalibrate={onCalibrate} />
        <MyGoalsCard />
      </div>
      <TeamTrendCard />
    </div>
  );
}

function GradingProgressCard({ onCalibrate }) {
  const { loading, error, periodKey, totals } = useGradingProgress();
  const t = totals ?? { total: 0, graded: 0, disputed: 0, acknowledged: 0 };

  return (
    <Card padding={20}>
      <Label>Grading progress · {periodKey}</Label>
      {error ? (
        <p className="mt-2 text-[13px] text-muted-fg">Couldn&apos;t load grading progress.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[30px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-fg">
              {loading ? "—" : `${t.graded} of ${t.total}`}
            </span>
            <span className="text-[13px] text-muted-fg">goals graded for {periodKey}</span>
          </div>
          <MiniBar value={t.graded} total={t.total} height={6} className="mt-3" />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-muted-fg">
            <span>{percent(t.graded, t.total)}% done</span>
            {t.acknowledged ? <span>{t.acknowledged} seen by the report</span> : null}
            {t.disputed ? (
              <span className="font-bold text-peach-text">{t.disputed} disputed</span>
            ) : null}
            <span className="flex-1" />
            <Button type="button" size="sm" variant="soft" onClick={onCalibrate}>
              Compare the team
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** "Dev Hub" stays "Dev Hub"; a bare "Dev" becomes "Dev hub" — never "Dev Hub hub". */
function hubName(label) {
  const name = (label || "Dev").trim();
  return /\bhub$/i.test(name) ? name : `${name} hub`;
}

function MyGoalsCard() {
  const { status, hubs } = useAvailableHubs();
  if (status !== "ready") return <Card padding={20}><Label>My goals</Label></Card>;
  const dev = hubs.find((h) => h.id === "dev");

  return (
    <Card padding={20}>
      <Label>My goals</Label>
      {dev ? (
        <>
          <p className="mt-2 text-[13px] leading-[1.55] text-muted-fg">
            Your own goals, evidence and grades live in the {hubName(dev.label)} —
            the same place your team tracks theirs.
          </p>
          <Button as={Link} href={`/${dev.id}/goals`} size="sm" className="mt-3" arrow>
            Open my goals
          </Button>
        </>
      ) : (
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-fg">
          Managers have goals too. To track your own, ask an admin to give you
          access to the Dev hub — your goals, evidence and grades live there,
          and your own manager grades them the same way you grade your team.
        </p>
      )}
    </Card>
  );
}

function TeamTrendCard() {
  const { loading, error, reports } = useTeamTrends(12);
  const withData = reports.filter((r) => r.series.length > 0);

  return (
    <Card padding={20}>
      <div className="flex flex-wrap items-baseline gap-2">
        <Label>Team trend</Label>
        <span className="text-[12px] text-muted-fg">Weekly snapshots, last 12 weeks</span>
      </div>
      {error ? (
        <p className="mt-2 text-[13px] text-muted-fg">Couldn&apos;t load the team trend.</p>
      ) : loading ? (
        <p className="mt-2 text-[13px] text-muted-fg">Loading…</p>
      ) : withData.length === 0 ? (
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-fg">
          No weekly snapshots from your team yet. They&apos;re captured when each
          person opens their dashboard, and frozen weekly by the scheduler.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {withData.map((r) => {
              const data = mergedSeries(r.series);
              return (
                <div key={r.id} className="rounded-[var(--radius-lg)] bg-card-alt p-3">
                  <div className="truncate text-[12.5px] font-bold text-fg">{r.displayName}</div>
                  {data.length >= 2 ? (
                    <>
                      <Sparkline
                        data={data}
                        height={32}
                        fillOpacity={0.08}
                        className="mt-1.5"
                      />
                      <div className="text-[11px] text-muted-fg">Merged PRs per week</div>
                    </>
                  ) : (
                    <div className="mt-1.5 flex h-8 items-center text-[11.5px] text-muted-fg">
                      {data.length === 0 ? "No PR data in their snapshots" : "Not enough weeks yet"}
                    </div>
                  )}
                  <div className="mt-1 truncate text-[11.5px] text-muted-fg">
                    Latest: {latestWeekLine(r.series)}
                  </div>
                </div>
              );
            })}
          </div>
          {withData.length < reports.length ? (
            <p className="mt-2.5 text-[12px] text-muted-fg">
              {plural(reports.length - withData.length, "person has", "people have")} no
              snapshots yet.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
