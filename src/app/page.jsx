import { AppHeader } from "@/components/app-header";
import { BentoGrid } from "@/components/bento/bento-grid";
import { ConnectedIntegrationsTile } from "@/components/bento/connected-integrations-tile";
import { AssignedTicketsTile } from "@/components/bento/assigned-tickets-tile";
import { OpenMRsTile } from "@/components/bento/open-mrs-tile";
import {
  SprintProgressTile,
  CycleTimeTile,
  SlaEvidenceTile,
  MergedThisWeekTile,
  AvgReviewRoundsTile,
  ReviewTurnaroundTile,
  ReviewsGivenTile,
  TicketMrLinkageTile,
  ActivityTile,
} from "@/components/bento/metric-tiles";
import {
  WeeklySnapshotTile,
  EvidenceExportTile,
  TaggedEvidenceTile,
} from "@/components/bento/evidence-tiles";

export default function DashboardPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Your performance at a glance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live metrics from Jira, GitLab and GitHub · snapshot and export for your next
            L0/L1/L2 review.
          </p>
        </div>
        <BentoGrid>
          <ConnectedIntegrationsTile />
          <SprintProgressTile />
          <CycleTimeTile />
          <AssignedTicketsTile />
          <SlaEvidenceTile />
          <OpenMRsTile />
          <MergedThisWeekTile />
          <AvgReviewRoundsTile />
          <ReviewTurnaroundTile />
          <ReviewsGivenTile />
          <TicketMrLinkageTile />
          <ActivityTile />
          <WeeklySnapshotTile />
          <EvidenceExportTile />
          <TaggedEvidenceTile />
        </BentoGrid>
      </main>
    </>
  );
}
