"use client";

import { Ticket, ExternalLink } from "lucide-react";
import useSWR from "swr";
import Link from "next/link";
import { BentoTile, TileEmpty } from "./bento-grid";
import { jiraApi } from "@/lib/api-client";
import { useIntegrations } from "@/hooks/use-integrations";

const STATUS_ORDER = ["To Do", "In Progress", "In Review", "Blocked", "Done"];

function groupByStatus(issues = []) {
  const map = {};
  for (const i of issues) {
    const s = i.fields?.status?.name || "Unknown";
    map[s] ??= [];
    map[s].push(i);
  }
  return map;
}

export function AssignedTicketsTile() {
  const { isConnected } = useIntegrations();
  const connected = isConnected("jira");
  const { data, error, isLoading } = useSWR(
    connected ? "jira:my-issues" : null,
    () => jiraApi.myIssues(),
    { revalidateOnFocus: false },
  );

  if (!connected) {
    return (
      <BentoTile title="My Jira Tickets" icon={Ticket} colSpan="md:col-span-4" rowSpan="row-span-3">
        <TileEmpty
          message="Connect Jira to see your assigned tickets."
          cta={
            <Link
              href="/settings"
              className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary/40"
            >
              Connect Jira
            </Link>
          }
        />
      </BentoTile>
    );
  }

  const grouped = groupByStatus(data?.issues || []);
  const total = data?.issues?.length ?? 0;

  return (
    <BentoTile
      title="My Jira Tickets"
      subtitle={isLoading ? "Loading..." : `${total} open`}
      icon={Ticket}
      colSpan="md:col-span-4"
      rowSpan="row-span-3"
    >
      {error ? (
        <div className="text-sm text-danger">Failed to load: {String(error.message)}</div>
      ) : (
        <div className="grid h-full grid-cols-2 gap-3 overflow-hidden md:grid-cols-3">
          {STATUS_ORDER.filter((s) => grouped[s]?.length).map((status) => (
            <div key={status} className="flex min-h-0 flex-col">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {status} · {grouped[status].length}
              </div>
              <ul className="flex-1 space-y-1 overflow-y-auto pr-1">
                {grouped[status].slice(0, 5).map((issue) => (
                  <li key={issue.id}>
                    <a
                      href={`${process.env.NEXT_PUBLIC_JIRA_URL || ""}/browse/${issue.key}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-1.5 rounded-md border border-border/60 bg-background/40 p-2 text-xs hover:border-primary/40"
                    >
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {issue.key}
                      </span>
                      <span className="line-clamp-2 flex-1">{issue.fields?.summary}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </BentoTile>
  );
}
