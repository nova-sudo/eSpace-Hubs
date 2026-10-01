"use client";

/**
 * The manager's roster page — ONE component behind both /[hub] (Team)
 * and /[hub]/employees (Employees), which used to be two roster screens
 * that drifted apart. The route only supplies the header copy.
 *
 * Three views of the same team, switched by a segmented control and
 * remembered per device (localStorage `espace-manager-view`, broadcast
 * so a second tab follows along):
 *
 *   Table   compare six people down a column — goals, graded, needs
 *           setup, and the tier spread the API always returned
 *   Queue   what you owe, grouped by person rather than by obligation
 *   People  a rail of reports, one person's standing at a time
 *   Calibration  reports side by side on the tier ladder for one grading
 *           period — your grades only, with disputes (team-calibration-view)
 *
 * `lead` renders between the header and the filters — the dashboard puts
 * its overview (grading progress, team trend, my goals) there.
 *
 * Data: GET /manager/reports, /manager/team-summary (one call for every
 * report's rollup), /manager/delegated-queue, /manager/approvals.
 */

import { useMemo, useState } from "react";
import {
  Input,
  PageHeader,
  SegmentedControl,
  Select,
  PageContainer,
} from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useManagerReports } from "./use-manager-reports";
import { useDelegatedQueue } from "./use-delegated-queue";
import { useApprovalsQueue } from "./use-approvals-queue";
import { useTeamGoalSummary } from "./use-team-goal-summary";
import { useManagerView } from "./use-manager-view";
import { TEAM_VIEW_KEY, TEAM_VIEWS } from "./manager-view-store";
import { EmptyCard } from "./manager-ui";
import { plural, waitedFor } from "./manager-format";
import { TeamTableView } from "./team-table-view";
import { TeamQueueView } from "./team-queue-view";
import { TeamPeopleView } from "./team-people-view";
import { TeamCalibrationView } from "./team-calibration-view";
import { useGradingProgress } from "./use-grading-progress";

const VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "queue", label: "Queue" },
  { value: "people", label: "People" },
  { value: "calibration", label: "Calibration" },
];

const UNASSIGNED = "Unassigned";
const EMPTY_STAT = {
  total: 0,
  graded: 0,
  needsAttention: 0,
  behind: 0,
  needsSetup: 0,
  noTracker: 0,
  delegatedToYou: 0,
  byTier: null,
  byStatus: {},
  worst: null,
  lastEntryAt: null,
  openDisputes: 0,
  packet: null,
};

/**
 * Who needs you first: open disagreements and unopened packets (things
 * waiting on YOU), then goals behind, then the rest — alphabetical within
 * a tie so the order is stable.
 */
function needRank(stat) {
  return (
    (stat.openDisputes ?? 0) * 100 +
    (stat.packet?.state === "new" ? 50 : 0) +
    (stat.behind ?? 0) * 10 +
    (stat.worst?.status === "not-logged" ? 1 : 0)
  );
}

export function ManagerTeamPage({ crumb, title, subtitle, lead = null }) {
  const link = useHubLink();
  const [view, setView] = useManagerView(TEAM_VIEW_KEY, TEAM_VIEWS, "table");
  const { loading, reports, error } = useManagerReports();
  const { items: delegated, loading: delLoading } = useDelegatedQueue();
  const { items: approvals, loading: apprLoading } = useApprovalsQueue();
  const { loading: summaryLoading, totals, perReport } = useTeamGoalSummary(reports);
  const progress = useGradingProgress();
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");

  const departments = useMemo(() => {
    const set = new Set(reports.map((r) => r.department || UNASSIGNED));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      const d = r.department || UNASSIGNED;
      if (dept && d !== dept) return false;
      if (!q) return true;
      return (
        r.displayName?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.role?.toLowerCase().includes(q)
      );
    });
  }, [reports, query, dept]);
  // Stable across renders so TeamCalibrationView's row memo holds.
  const visibleIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);

  const tableRows = filtered
    .map((report) => ({
      report,
      stat: perReport.get(report.id) ?? EMPTY_STAT,
    }))
    .sort(
      (a, b) =>
        needRank(b.stat) - needRank(a.stat) ||
        (a.report.displayName || "").localeCompare(b.report.displayName || ""),
    );

  // What you owe, per person. Only people with something outstanding
  // make the queue — an empty card is the honest answer to "nothing".
  const queueRows = filtered
    .map((report) => {
      const stat = perReport.get(report.id) ?? EMPTY_STAT;
      const ungraded = Math.max(0, stat.total - stat.graded);
      const mine = approvals.filter((a) => a.user.id === report.id);
      const waiting = delegated.filter(
        (d) => d.user.id === report.id && !d.verdict,
      );
      const oldestApproval = mine.reduce(
        (min, a) =>
          a.submittedAt && (min == null || a.submittedAt < min) ? a.submittedAt : min,
        null,
      );
      const actions = [];
      if (stat.openDisputes > 0) {
        actions.push({
          key: "dispute",
          what: "Disagrees",
          tone: "peach",
          detail: `${plural(stat.openDisputes, "grade", "grades")} ${report.displayName.split(" ")[0]} disagrees with`,
          href: `/employees/${report.id}`,
        });
      }
      if (stat.packet?.state === "new") {
        actions.push({
          key: "packet",
          what: "New packet",
          tone: "sky",
          detail: `Review packet submitted ${waitedFor(stat.packet.submittedAt) ?? "recently"}${
            waitedFor(stat.packet.submittedAt) === "today" ? "" : " ago"
          }`,
          href: `/employees/${report.id}`,
        });
      }
      if (ungraded > 0) {
        actions.push({
          key: "grade",
          what: "Grade",
          tone: "peach",
          detail: `${plural(ungraded, "goal", "goals")} ungraded`,
          href: `/employees/${report.id}`,
        });
      }
      if (mine.length > 0) {
        const waited = waitedFor(oldestApproval);
        actions.push({
          key: "approve",
          what: "Approve",
          tone: "lemon",
          detail: `${plural(mine.length, "tracker", "trackers")} waiting${
            waited ? ` · oldest ${waited}` : ""
          }`,
          href: "/approvals",
        });
      }
      if (waiting.length > 0) {
        actions.push({
          key: "delegated",
          what: "Delegated",
          tone: "lav",
          detail: `${plural(waiting.length, "goal", "goals")} awaiting your judgement`,
          href: "/delegated",
        });
      }
      return { report: { ...report, goals: stat.total }, actions };
    })
    .filter((row) => row.actions.length > 0);

  const delegatedOpen = delegated.filter((d) => !d.verdict).length;
  const countsLoading = loading || summaryLoading || delLoading || apprLoading;
  // Everything waiting on YOU, named: a disagreement and an unopened packet
  // are as much yours to act on as an approval — "nothing awaiting you"
  // used to show while a report's packet and dispute sat unread.
  const awaitingParts = [
    totals.openDisputes ? plural(totals.openDisputes, "disagreement", "disagreements") : null,
    totals.newPackets ? plural(totals.newPackets, "new packet", "new packets") : null,
    approvals.length ? plural(approvals.length, "approval", "approvals") : null,
    delegatedOpen ? plural(delegatedOpen, "delegated goal", "delegated goals") : null,
  ].filter(Boolean);

  const summaryLine = countsLoading
    ? "Loading your team…"
    : [
        plural(reports.length, "report", "reports"),
        plural(totals.goals, "goal", "goals"),
        `${totals.graded} graded`,
        totals.needsSetup ? `${totals.needsSetup} need setup` : null,
        awaitingParts.length
          ? `${awaitingParts.join(" · ")} awaiting you`
          : "nothing awaiting you",
      ]
        .filter(Boolean)
        .join(" · ");

  function body() {
    if (error) {
      return (
        <EmptyCard>
          Couldn&apos;t load your team right now. Refresh, or check back in a
          moment.
        </EmptyCard>
      );
    }
    if (loading) return <EmptyCard>Loading your team…</EmptyCard>;
    if (reports.length === 0) {
      return (
        <EmptyCard>
          No direct reports are assigned to you yet. An admin sets each
          engineer&apos;s manager under{" "}
          <span className="font-bold text-fg">User management</span> — once
          that&apos;s in place, your team shows up here.
        </EmptyCard>
      );
    }
    if (filtered.length === 0) {
      return <EmptyCard>No one matches that search.</EmptyCard>;
    }
    if (view === "queue") return <TeamQueueView rows={queueRows} link={link} />;
    if (view === "calibration") {
      return (
        <TeamCalibrationView
          visibleIds={visibleIds}
          link={link}
        />
      );
    }
    if (view === "people") {
      return (
        <TeamPeopleView
          reports={filtered}
          perReport={perReport}
          link={link}
          toolCounts={{
            delegated: delegatedOpen,
            approvals: approvals.length,
          }}
        />
      );
    }
    return (
      <TeamTableView
        rows={tableRows}
        totals={totals}
        totalsLoading={summaryLoading}
        progress={progress}
        link={link}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        crumb={crumb}
        title={title}
        subtitle={subtitle}
        right={
          <SegmentedControl ariaLabel="Team view"
            options={VIEW_OPTIONS}
            value={view}
            onChange={setView}
            size="sm"
          />
        }
      />

      {lead}

      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, role…"
          className="max-w-[260px]"
          aria-label="Search reports"
        />
        <Select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          placeholder="All departments"
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <span className="text-[12.5px] text-muted-fg">
          {(query || dept) && !loading
            ? `${filtered.length} of ${reports.length}`
            : summaryLine}
        </span>
      </div>

      <div className="mt-6">{body()}</div>
    </PageContainer>
  );
}
