"use client";

/**
 * Manager Hub — Employees roster. Renders at /[hub]/employees.
 *
 * The same roster as the Team page (<ManagerTeamPage />) under its own
 * route and header: search, department filter, the three views, and each
 * row opening that report's board at /[hub]/employees/:id. Keeping one
 * component is the point — two roster screens is how they drift.
 */

import { ManagerTeamPage } from "./manager-team-page";

export function ManagerEmployees() {
  return (
    <ManagerTeamPage
      crumb="Employees · pick someone to open their board"
      title="Every report, in depth."
      subtitle="Open a teammate to see their full goal board and where each goal stands on the achievement tiers."
    />
  );
}
