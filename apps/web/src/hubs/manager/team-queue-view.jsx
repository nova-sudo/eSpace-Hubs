"use client";

/**
 * Team view "Queue" — what you owe, grouped by PERSON.
 *
 * One card per report carrying every outstanding action against them:
 * ungraded goals, trackers waiting on approval, delegated goals waiting
 * on your judgement. A queue keyed by obligation instead would give
 * twelve reports × three duties = thirty-six rows and break the way a
 * lead actually works — you sit down with a person, not with a duty.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar, Badge, Card } from "@/components/ui";
import { EmptyCard } from "./manager-ui";

export function TeamQueueView({ rows, link }) {
  if (rows.length === 0) {
    return (
      <EmptyCard>
        Nothing is waiting on you. When a report leaves a goal ungraded,
        composes a tracker, or delegates a goal to your judgement, they show
        up here.
      </EmptyCard>
    );
  }

  return (
    <div className="grid max-w-[880px] gap-3">
      {rows.map(({ report, actions }) => (
        <Card key={report.id} padding={18}>
          <div className="flex items-center gap-3">
            <Avatar name={report.displayName} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-bold text-fg">
                {report.displayName}
              </div>
              <div className="truncate text-[11.5px] text-muted-fg">
                {[report.role, report.department].filter(Boolean).join(" · ")}
                {report.goals != null ? ` · ${report.goals} goals` : ""}
              </div>
            </div>
            {/* One ink action per card — it opens whatever is most
                overdue for this person, which is the first row below. */}
            <Link
              href={link(actions[0]?.href ?? `/employees/${report.id}`)}
              className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-pill)] bg-ink px-5 text-[13px] font-bold text-ink-on transition-opacity hover:opacity-90"
            >
              Start
            </Link>
          </div>

          <div className="mt-3 grid gap-1.5">
            {actions.map((action) => (
              <Link
                key={action.key}
                href={link(action.href)}
                className="flex items-center gap-2.5 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5 transition-colors hover:opacity-80"
              >
                <Badge tone={action.tone}>{action.what}</Badge>
                <span className="min-w-0 flex-1 text-[12.5px] text-fg">
                  {action.detail}
                </span>
                <ChevronRight size={15} className="shrink-0 text-muted-fg" />
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
