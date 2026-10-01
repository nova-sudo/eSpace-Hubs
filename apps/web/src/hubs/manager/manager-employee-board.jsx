"use client";

/**
 * Manager Hub — one report's board. Renders at /[hub]/employees/:userId.
 *
 * Two views of the same goal-health payload, switched by a segmented
 * control and remembered per device (localStorage
 * `espace-manager-board-view`):
 *
 *   Board        goals under their objective bands, with the objective's
 *                weightage, and a rail carrying the tier spread, the
 *                counts and the review packet
 *   Consistency  the same goals as a table — AI verdict, your grade, and
 *                the delta — so twelve grades can be read on one scale
 *   Notes        your running 1:1 journal on this report (private, or
 *                shared with them)
 *
 * The header carries a one-click download of their latest review packet
 * (the frozen evidence document they submitted), when there is one.
 *
 * Both open the same grading drawer. Data: GET
 * /manager/reports/:userId/goal-health.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { Button, PageHeader, SegmentedControl, PageContainer } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useReportHealth } from "./use-report-health";
import { useManagerView } from "./use-manager-view";
import { BOARD_VIEW_KEY } from "./manager-view-store";
import { EmptyCard } from "./manager-ui";
import { EmployeeBoardView } from "./employee-board-view";
import { EmployeeConsistencyView } from "./employee-consistency-view";
import { ManagerGradeDrawer } from "./manager-grade-drawer";
import { ReportNotesView } from "./report-notes-view";
import { downloadPacketMarkdown, useReviewPackets } from "./use-review-packets";

const VIEWS = ["board", "consistency", "notes"];
const VIEW_OPTIONS = [
  { value: "board", label: "Board" },
  { value: "consistency", label: "Consistency" },
  { value: "notes", label: "Notes" },
];

export function ManagerEmployeeBoard({ userId }) {
  const link = useHubLink();
  const [view, setView] = useManagerView(BOARD_VIEW_KEY, VIEWS, "board");
  const [grading, setGrading] = useState(null);
  const { loading, data, error, refresh } = useReportHealth(userId);
  const { packets } = useReviewPackets(userId);
  const latestPacket = packets.find((p) => p.markdown) ?? null;

  // "Back to team" rides in the header's action slot — the same place every
  // other drill-in page (shared goal detail) puts its way back.
  const back = (
    <Button as={Link} href={link("/employees")} variant="ghost" size="sm">
      <ArrowLeft size={14} /> Team
    </Button>
  );

  if (loading || error || !data) {
    return (
      <PageContainer>
        <PageHeader crumb="Reports to you" title="Report board." right={back} />
        <EmptyCard>
          {loading
            ? "Loading the board…"
            : error?.code === "not_found"
              ? "That teammate isn't on your team."
              : "Couldn't load this board right now. Refresh, or check back in a moment."}
        </EmptyCard>
      </PageContainer>
    );
  }

  const { user, summary, groups } = data;
  const ungraded = groups
    .flatMap((g) => g.goals)
    .filter((g) => g.tier?.source !== "manager");

  return (
    <PageContainer>
      <PageHeader
        crumb={
          [user.role, user.department, user.level].filter(Boolean).join(" · ") ||
          "Reports to you"
        }
        title={user.displayName}
        subtitle={
          ungraded.length > 0
            ? `${ungraded.length} of ${summary.total} goals don't have your grade yet.`
            : summary.total > 0
              ? "Every goal has your grade."
              : null
        }
        right={
          <div className="flex flex-wrap items-center gap-2.5">
            {back}
            <SegmentedControl ariaLabel="Report view"
              options={VIEW_OPTIONS}
              value={view}
              onChange={setView}
              size="sm"
            />
            {latestPacket ? (
              <Button
                type="button"
                variant="soft"
                size="sm"
                onClick={() => downloadPacketMarkdown(latestPacket, user.displayName)}
                title="Download the review packet they submitted, as markdown"
              >
                <Download size={13} /> Review packet
              </Button>
            ) : null}
            {/* The one ink button on this view — every per-goal "Grade"
                below is soft. */}
            {ungraded.length > 0 ? (
              <Button type="button" size="sm" onClick={() => setGrading(ungraded[0])}>
                Grade {ungraded.length} ungraded
              </Button>
            ) : null}
          </div>
        }
      />

      {view === "notes" ? (
        <ReportNotesView userId={userId} user={user} />
      ) : view === "consistency" ? (
        <EmployeeConsistencyView
          user={user}
          summary={summary}
          groups={groups}
          userId={userId}
          onGrade={setGrading}
          onSaved={refresh}
        />
      ) : (
        <EmployeeBoardView
          user={user}
          summary={summary}
          groups={groups}
          userId={userId}
          onGrade={setGrading}
        />
      )}

      <p className="mt-9 text-[12.5px] leading-[1.6] text-muted-fg">
        Your grade overrides the AI tier and notifies the engineer.
      </p>

      <ManagerGradeDrawer
        open={!!grading}
        goal={grading}
        userId={userId}
        userName={user?.displayName}
        summary={summary}
        onClose={() => setGrading(null)}
        onSaved={() => {
          setGrading(null);
          refresh();
        }}
      />
    </PageContainer>
  );
}
