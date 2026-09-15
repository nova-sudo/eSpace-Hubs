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
 *
 * Both open the same grading drawer. Data: GET
 * /manager/reports/:userId/goal-health.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Avatar, SegmentedControl } from "@/components/ui";
import { useHubLink } from "@/features/hubs";
import { useReportHealth } from "./use-report-health";
import { useManagerView } from "./use-manager-view";
import { BOARD_VIEW_KEY } from "./manager-view-store";
import { EmptyCard } from "./manager-ui";
import { EmployeeBoardView } from "./employee-board-view";
import { EmployeeConsistencyView } from "./employee-consistency-view";
import { ManagerGradeDrawer } from "./manager-grade-drawer";

const VIEWS = ["board", "consistency"];
const VIEW_OPTIONS = [
  { value: "board", label: "Board" },
  { value: "consistency", label: "Consistency" },
];

export function ManagerEmployeeBoard({ userId }) {
  const link = useHubLink();
  const [view, setView] = useManagerView(BOARD_VIEW_KEY, VIEWS, "board");
  const [grading, setGrading] = useState(null);
  const { loading, data, error, refresh } = useReportHealth(userId);

  const back = (
    <Link
      href={link("/employees")}
      className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-fg"
    >
      <ArrowLeft size={14} /> Back to team
    </Link>
  );

  if (loading) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
        {back}
        <EmptyCard>Loading the board…</EmptyCard>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
        {back}
        <EmptyCard>
          {error === "not_found"
            ? "That teammate isn't on your team."
            : "Couldn't load this board right now. Refresh, or check back in a moment."}
        </EmptyCard>
      </main>
    );
  }

  const { user, summary, groups } = data;
  const ungraded = groups
    .flatMap((g) => g.goals)
    .filter((g) => g.tier?.source !== "manager");

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
      {back}

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={user.displayName} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-extrabold leading-[1.1] tracking-[-0.02em] text-fg">
            {user.displayName}
          </h1>
          <div className="mt-1 text-[12.5px] text-muted-fg">
            {[user.role, user.department, user.level].filter(Boolean).join(" · ")} ·
            reports to you
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={view}
            onChange={setView}
            size="sm"
          />
          {ungraded.length > 0 ? (
            <button
              type="button"
              onClick={() => setGrading(ungraded[0])}
              className="inline-flex h-9 items-center rounded-[var(--radius-pill)] bg-ink px-5 text-[13px] font-bold text-ink-on transition-opacity hover:opacity-90"
            >
              Grade {ungraded.length} ungraded
            </button>
          ) : null}
        </div>
      </div>

      {view === "consistency" ? (
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
    </main>
  );
}
