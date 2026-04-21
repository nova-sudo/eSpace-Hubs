"use client";

import useSWR from "swr";
import Link from "next/link";
import { GitPullRequest, Eye, ExternalLink } from "lucide-react";
import { BentoTile, TileEmpty } from "./bento-grid";
import { gitlabApi, githubApi } from "@/lib/api-client";
import { useIntegrations } from "@/hooks/use-integrations";

export function OpenMRsTile() {
  const { isConnected } = useIntegrations();
  const hasGitlab = isConnected("gitlab");
  const hasGithub = isConnected("github");
  const anyConnected = hasGitlab || hasGithub;

  const { data: glMine } = useSWR(hasGitlab ? "gl:my" : null, () => gitlabApi.myMergeRequests(), {
    revalidateOnFocus: false,
  });
  const { data: glReview } = useSWR(
    hasGitlab ? "gl:review" : null,
    () => gitlabApi.reviewRequests(),
    { revalidateOnFocus: false },
  );
  const { data: ghMine } = useSWR(hasGithub ? "gh:my" : null, () => githubApi.myPulls(), {
    revalidateOnFocus: false,
  });
  const { data: ghReview } = useSWR(
    hasGithub ? "gh:review" : null,
    () => githubApi.reviewRequests(),
    { revalidateOnFocus: false },
  );

  if (!anyConnected) {
    return (
      <BentoTile title="Open PRs / MRs" icon={GitPullRequest} colSpan="md:col-span-2" rowSpan="row-span-3">
        <TileEmpty
          message="Connect GitLab or GitHub to see open pull/merge requests."
          cta={
            <Link
              href="/settings"
              className="rounded-md border border-border px-3 py-1 text-xs hover:border-primary/40"
            >
              Connect a provider
            </Link>
          }
        />
      </BentoTile>
    );
  }

  const mine = [
    ...(glMine || []).map((mr) => ({ id: `gl-${mr.id}`, title: mr.title, url: mr.web_url, source: "GitLab" })),
    ...(ghMine?.items || []).map((pr) => ({
      id: `gh-${pr.id}`,
      title: pr.title,
      url: pr.html_url,
      source: "GitHub",
    })),
  ];
  const review = [
    ...(glReview || []).map((mr) => ({
      id: `gl-${mr.id}`,
      title: mr.title,
      url: mr.web_url,
      source: "GitLab",
    })),
    ...(ghReview?.items || []).map((pr) => ({
      id: `gh-${pr.id}`,
      title: pr.title,
      url: pr.html_url,
      source: "GitHub",
    })),
  ];

  return (
    <BentoTile
      title="Open PRs / MRs"
      subtitle={`${mine.length} yours · ${review.length} awaiting your review`}
      icon={GitPullRequest}
      colSpan="md:col-span-2"
      rowSpan="row-span-3"
    >
      <div className="flex h-full flex-col gap-3 overflow-hidden">
        <Section title="Mine" items={mine.slice(0, 4)} icon={GitPullRequest} />
        <Section title="Awaiting review" items={review.slice(0, 4)} icon={Eye} />
      </div>
    </BentoTile>
  );
}

function Section({ title, items, icon: Icon }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {title} · {items.length}
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <li className="text-xs text-muted-foreground/70">Nothing here — nice.</li>
        ) : (
          items.map((item) => (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-1.5 rounded-md border border-border/60 bg-background/40 p-2 text-xs hover:border-primary/40"
              >
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {item.source}
                </span>
                <span className="line-clamp-1 flex-1">{item.title}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
