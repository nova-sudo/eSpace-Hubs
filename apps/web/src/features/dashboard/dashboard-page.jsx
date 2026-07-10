"use client";

import { ScrollShell } from "./scroll-shell";
import {
  OverviewSection,
  ReviewTimingSection,
  GlanceSection,
  TrendSection,
} from "./sections";

export function DashboardPage() {
  return (
    <ScrollShell>
      <OverviewSection />
      <ReviewTimingSection />
      <GlanceSection />
      <TrendSection />
    </ScrollShell>
  );
}
