"use client";

import { BentoTile, Pill } from "@/components/ui";
import { useJiraTickets, useIntegrations } from "@/features/integrations";
import { fullDate } from "@/lib/date";

const COLUMNS = [
  { key: "indeterminate", label: "In flight", tone: "accent" },
  { key: "new", label: "Queued", tone: "default" },
  { key: "done", label: "Shipped", tone: "ok" },
];

function groupByCategory(issues = []) {
  const out = { indeterminate: [], new: [], done: [] };
  for (const i of issues) {
    const cat = i.fields?.status?.statusCategory?.key;
    if (out[cat]) out[cat].push(i);
  }
  return out;
}

export function TicketsTile() {
  const { isConnected } = useIntegrations();
  const { data, isLoading } = useJiraTickets();
  const issues = data?.issues || [];
  const grouped = groupByCategory(issues);

  return (
    <BentoTile
      col="span 7"
      row="span 3"
      label={`Jira · ${issues.length} assigned to you`}
      title="Tickets on your plate"
      titleSize={18}
      right={
        <a
          href={process.env.NEXT_PUBLIC_JIRA_URL || "#"}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] uppercase tracking-[0.4px] text-muted-fg hover:text-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          Open board ↗
        </a>
      }
    >
      {!isConnected("jira") ? (
        <div className="flex h-full items-center justify-center text-[13px] text-muted-fg">
          Connect Jira to see your tickets.
        </div>
      ) : isLoading ? (
        <div className="flex h-full items-center justify-center text-[13px] text-muted-fg">
          Loading…
        </div>
      ) : (
        <div className="mt-1.5 grid h-full grid-cols-3 gap-2.5 overflow-hidden">
          {COLUMNS.map((col) => {
            const items = grouped[col.key] || [];
            return (
              <div key={col.key} className="flex min-h-0 flex-col">
                <div className="mb-1.5">
                  <Pill tone={col.tone}>
                    {col.label} · {items.length}
                  </Pill>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
                  {items.map((t) => {
                    const due = t.fields?.duedate;
                    return (
                      <a
                        key={t.id}
                        href={`${process.env.NEXT_PUBLIC_JIRA_URL || ""}/browse/${t.key}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-[var(--radius-sub)] border border-border bg-card-alt px-2.5 py-2 transition-colors hover:border-border-strong"
                      >
                        <div className="mb-0.5 flex items-center justify-between">
                          <span
                            className="font-bold text-accent"
                            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                          >
                            {t.key}
                          </span>
                          <span
                            className="text-dim-fg"
                            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                          >
                            {due ? fullDate(due) : "—"}
                          </span>
                        </div>
                        <div
                          className="text-[12px] leading-[1.35]"
                          style={{ textWrap: "pretty" }}
                        >
                          {t.fields?.summary}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </BentoTile>
  );
}
