"use client";

/**
 * /[hub]/shared-goals — shared goals whose analytics someone gave you
 * access to (you're a viewer). /[hub]/shared-goals/:id opens one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useActiveHub } from "@/features/hubs";
import { useSharedWithMe } from "./api";
import { AssignedGoalProgress } from "./assigned-goal-progress";
import { SharedGoalsList } from "./shared-goals-list";

export function SharedWithMePage({ goalId = null }) {
  const hub = useActiveHub();
  const router = useRouter();
  const base = `/${hub?.id ?? ""}/shared-goals`;
  const { goals, loading, error } = useSharedWithMe();

  if (goalId) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
        <Link
          href={base}
          className="mb-4 inline-flex items-center gap-1 text-[13px] font-bold text-fg hover:opacity-80"
        >
          <ChevronLeft size={16} /> Shared with me
        </Link>
        <AssignedGoalProgress goalId={goalId} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[960px] px-4 pb-16 pt-7 sm:px-10">
      <PageHeader
        crumb="Shared goals"
        title="Shared with me."
        subtitle="Goals someone gave you visibility into: who filled each period, when, and who's late."
      />
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
    </main>
  );
}
