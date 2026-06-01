"use client";

import { MonoLabel } from "@/components/ui";
import {
  deriveAttention,
  useGitlabOpenMRs,
  useGithubOpenPulls,
  useJiraTickets,
} from "@/features/integrations";
import { useMyEngagementConfig } from "@/features/auth";

export function AttentionBand() {
  const { data: glOpen } = useGitlabOpenMRs();
  const { data: ghOpen } = useGithubOpenPulls();
  const { data: tickets } = useJiraTickets();
  const { config: engagementCfg } = useMyEngagementConfig();
  // Union both providers' open items so a GitHub-only user gets stale-PR
  // nudges too (mirror of the GitLab MR path). Tag each with its source
  // so deriveAttention picks the right field names + ref notation.
  const openItems = [
    ...(glOpen || []).map((m) => ({ ...m, source: "gitlab" })),
    ...(ghOpen?.items || []).map((p) => ({ ...p, source: "github" })),
  ];
  const items = deriveAttention({
    openMRs: openItems,
    tickets: tickets?.issues || [],
    // Per-user Jira base — eSpace devs get eSpace's Jira host,
    // Crealogix devs get Crealogix's. Env fallback for early mount.
    jiraBaseUrl:
      engagementCfg?.jiraBaseUrl || process.env.NEXT_PUBLIC_JIRA_URL,
    limit: 3,
  });

  if (items.length === 0) return null;

  return (
    <section className="relative z-[2] px-10 pb-5">
      <div
        className="rounded-[var(--radius-tile)] border border-border bg-card px-4.5 py-3.5"
        style={{ borderLeft: "3px solid var(--accent)" }}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MonoLabel>Needs your attention · {items.length}</MonoLabel>
            <span className="text-[12px] text-muted-fg">Quiet nudges, not alarms.</span>
          </div>
          <span
            className="cursor-pointer text-[10px] uppercase tracking-[0.4px] text-muted-fg hover:text-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Dismiss all
          </span>
        </div>
        <div
          className="grid gap-2.5"
          style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}
        >
          {items.map((a) => (
            <a
              key={a.id}
              href={a.href}
              target="_blank"
              rel="noreferrer"
              className="block rounded-[var(--radius-sub)] border border-border bg-card-alt px-3 py-2.5 transition-colors hover:border-border-strong"
            >
              <div className="mb-1 flex items-baseline justify-between">
                <span
                  className="font-bold text-accent"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
                >
                  {a.ref}
                </span>
                <span
                  className="uppercase tracking-[0.4px] text-dim-fg"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
                >
                  {a.kind === "stale-pr" ? "Stale PR" : "Old ticket"} · {a.severity}
                </span>
              </div>
              <div
                className="mb-1 text-[12.5px] leading-[1.35]"
                style={{ textWrap: "pretty" }}
              >
                {a.title}
              </div>
              <div
                className="mb-1.5 text-muted-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              >
                {a.detail}
              </div>
              <span
                className="font-bold text-accent"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              >
                {a.action} ↗
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
