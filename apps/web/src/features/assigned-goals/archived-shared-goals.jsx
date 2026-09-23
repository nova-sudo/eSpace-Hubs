"use client";

/**
 * "Past cycles" for shared goals: ones a manager has archived, which have
 * left the assignee's goal tree. Read-only — how each period went, plus the
 * grade if one was set.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Card, Label } from "@/components/ui";
import { useMyAssignedGoals, useMyAssignedProgress } from "./api";
import { STATUS_META, fmtDay, fmtStamp, pct } from "./progress-grid";

const TIER_TEXT = {
  not_achieved: "Not achieved",
  achieved: "Achieved",
  over_achieved: "Over achieved",
  role_model: "Role model",
};

export function ArchivedSharedGoals() {
  const { goals } = useMyAssignedGoals({ includeArchived: true });
  const [openId, setOpenId] = useState(null);
  const archived = goals.filter((g) => g.status === "archived");
  if (archived.length === 0) return null;

  return (
    <section className="mt-8">
      <Label>Archived shared goals</Label>
      <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
        Shared goals a manager has closed. They&apos;ve left your goals; your
        entries and how each period went are kept here.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {archived.map((g) => {
          const open = openId === g.id;
          return (
            <li key={g.id}>
              <Card radius="lg" padding={0} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : g.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                >
                  {open ? (
                    <ChevronDown size={14} className="shrink-0 text-muted-fg" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-muted-fg" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-fg">
                    {g.title}
                  </span>
                  <Badge>{pct(g.totals?.onTimeRate)} on time</Badge>
                  <span className="shrink-0 text-[12px] text-muted-fg">
                    by {g.createdBy?.displayName} · closed {fmtDay(Date.parse(g.archivedAt))}
                  </span>
                </button>
                {open ? <MyPeriods id={g.id} /> : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MyPeriods({ id }) {
  const { mine, loading, error } = useMyAssignedProgress(id);
  return (
    <div className="border-t border-line px-4 py-3">
      {loading ? (
        <div className="text-[12px] text-muted-fg">Loading…</div>
      ) : error || !mine ? (
        <div className="text-[12px] text-muted-fg">Couldn&apos;t load this goal.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {mine.verdict ? (
            <div className="text-[13px]">
              Graded <strong>{TIER_TEXT[mine.verdict.tier]}</strong> by {mine.verdict.gradedByName}
              {mine.verdict.note ? ` — ${mine.verdict.note}` : ""}
            </div>
          ) : null}
          <ul className="flex flex-wrap gap-1.5">
            {mine.cells.map((c) => {
              const meta = STATUS_META[c.status] ?? STATUS_META.upcoming;
              return (
                <li
                  key={c.key ?? "once"}
                  className={`rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] font-bold ${meta.cls}`}
                  title={c.submittedAt ? `Submitted ${fmtStamp(c.submittedAt)}` : `Due ${fmtStamp(c.deadline)}`}
                >
                  {c.label} · {meta.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
