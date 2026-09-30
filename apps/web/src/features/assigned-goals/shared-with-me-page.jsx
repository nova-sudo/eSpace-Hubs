"use client";

/**
 * /[hub]/shared-goals — shared goals whose analytics someone gave you
 * access to (you're a viewer). /[hub]/shared-goals/:id opens one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button, PageContainer, PageHeader } from "@/components/ui";
import { DrillDownNav } from "@/components/shell/drill-down-nav";
import { useActiveHub } from "@/features/hubs";
import { useSharedWithMe } from "./api";
import { AssignedGoalProgress } from "./assigned-goal-progress";
import { SharedGoalsList } from "./shared-goals-list";

export function SharedWithMePage({ goalId = null }) {
  const hub = useActiveHub();
  const router = useRouter();
  const base = `/${hub?.id ?? ""}/shared-goals`;
  // The list isn't shown on the detail route — don't fetch it there.
  const { goals, loading, error } = useSharedWithMe({ enabled: !goalId });

  if (goalId) {
    return (
      <PageContainer>
        <PageHeader
          crumb="Shared goals · one goal"
          title="How the team is doing."
          right={
            <Button as={Link} href={base} variant="ghost">
              <ChevronLeft size={15} />
              Shared with me
            </Button>
          }
        />
        <DrillDownNav />
        <AssignedGoalProgress goalId={goalId} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        crumb="Shared goals"
        title="Shared with me."
        subtitle={
          <>
            Goals your manager shared so you can see how the team is doing. Goals assigned to you to
            fill in live on your{" "}
            {hub?.pages?.goals ? (
              <Link href={`/${hub.id}/goals`} className="font-bold text-fg underline-offset-2 hover:underline">
                Goals page
              </Link>
            ) : (
              "Goals page"
            )}
            .
          </>
        }
      />
      <DrillDownNav />
      {error ? (
        <div className="text-[13px] text-muted-fg">Couldn&apos;t load: {error.message}</div>
      ) : loading && goals.length === 0 ? (
        <div className="text-[13px] text-muted-fg">Loading…</div>
      ) : (
        <SharedGoalsList
          goals={goals}
          onSelect={(g) => router.push(`${base}/${g.id}`)}
          empty={
            <div>
              <div className="text-[15px] font-bold">Nothing shared with you yet</div>
              <div className="mt-1 text-[13px] text-muted-fg">
                When a manager adds you as a viewer on a shared goal, it shows up here.
              </div>
            </div>
          }
        />
      )}
    </PageContainer>
  );
}
