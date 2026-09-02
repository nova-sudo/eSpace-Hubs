"use client";

import { BentoTile } from "@/components/ui";
import { useCombinedEventsSince } from "@/features/integrations";
import { fmtRelative } from "@/lib/fmt";
import { isoDaysAgo } from "@/lib/date";

/**
 * Recent pushes across every connected host (compact-strip variant).
 *
 * The 1-row grid slot only fits one summary line, so we render the most
 * recent push prominently and surface the total push count from the last
 * fortnight in the label. Both GitLab and the GitHub normalizer emit a
 * `push_data.commit_title` + sha shape, so rendering is source-agnostic.
 */
export function CommitsTile() {
  const { data } = useCombinedEventsSince(isoDaysAgo(14));
  const commits = (data || [])
    .filter(
      (e) =>
        e.action_name?.startsWith("pushed") && e.push_data?.commit_title,
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((e) => ({
      sha: (e.push_data.commit_to || e.push_data.commit_from || "").slice(0, 7),
      msg: e.push_data.commit_title,
      repo:
        e.repo_name ||
        (e.project_id ? `project/${e.project_id}` : e.source || "repo"),
      when: fmtRelative(e.created_at),
    }));
  const latest = commits[0];
  const total = commits.length;

  return (
    <BentoTile
      col="span 4"
      row="span 1"
      label={`Recent commits${total > 0 ? ` · ${total} in 14d` : ""}`}
    >
      {!latest ? (
        <div className="flex flex-1 items-center text-[12px] text-muted-fg">
          No recent pushes.
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="font-bold text-accent"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
            >
              {latest.sha}
            </span>
            <span className="flex-1 truncate text-[12px]" title={latest.msg}>
              {latest.msg}
            </span>
          </div>
          <div
            className="text-dim-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
          >
            {latest.repo} · {latest.when} ago
          </div>
        </div>
      )}
    </BentoTile>
  );
}
