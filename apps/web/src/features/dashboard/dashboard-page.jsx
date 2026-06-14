"use client";

import { ScrollShell } from "./scroll-shell";
import {
  OverviewSection,
  ReviewTimingSection,
  GlanceSection,
  TrendSection,
} from "./sections";
import { CompactDashboard } from "./compact-dashboard";
import { useDashboardView } from "./use-dashboard-view";

export function DashboardPage() {
  const { mode } = useDashboardView();

  if (mode === "compact") {
    return <CompactDashboard />;
  }

  return (
    <ScrollShell>
      <OverviewSection />
      <ReviewTimingSection />
      <GlanceSection />
      <TrendSection />
    </ScrollShell>
  );
}
