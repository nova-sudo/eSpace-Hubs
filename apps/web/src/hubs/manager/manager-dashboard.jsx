"use client";

/**
 * Manager Hub — Team overview. Renders at /manager.
 *
 * The manager's landing surface. Everything it does lives in
 * <ManagerTeamPage />, which /[hub]/employees also renders: the two used
 * to be separate rosters that slowly diverged, and one team has one
 * roster. This file owns nothing but the header copy.
 */

import { useActiveHubStrict } from "@/features/hubs";
import { ManagerTeamPage } from "./manager-team-page";

export function ManagerDashboard() {
  const hub = useActiveHubStrict();
  return (
    <ManagerTeamPage
      crumb={`${hub.label} · team`}
      title="Your team, at a glance."
      subtitle="Your direct reports and where they stand — goal tracking, delegated goals, and grading, all in one view."
    />
  );
}
