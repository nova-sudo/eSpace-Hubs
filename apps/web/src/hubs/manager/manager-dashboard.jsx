"use client";

/**
 * Manager Hub — Team overview. Renders at /manager.
 *
 * The manager's landing surface. Everything it does lives in
 * <ManagerTeamPage />, which /[hub]/employees also renders: the two used
 * to be separate rosters that slowly diverged, and one team has one
 * roster. This file owns the header copy and the overview strip above
 * the roster (grading progress, my goals, team trend — manager-overview),
 * which the Employees page doesn't repeat.
 */

import { useActiveHubStrict } from "@/features/hubs";
import { ManagerTeamPage } from "./manager-team-page";
import { ManagerOverview } from "./manager-overview";
import { useManagerView } from "./use-manager-view";
import { TEAM_VIEW_KEY, TEAM_VIEWS } from "./manager-view-store";

export function ManagerDashboard() {
  const hub = useActiveHubStrict();
  const [, setView] = useManagerView(TEAM_VIEW_KEY, TEAM_VIEWS, "table");
  return (
    <ManagerTeamPage
      lead={<ManagerOverview onCalibrate={() => setView("calibration")} />}
      crumb={`${hub.label} · team`}
      title="Your team, at a glance."
      subtitle="Your direct reports and where they stand — goal tracking, delegated goals, and grading, all in one view."
    />
  );
}
