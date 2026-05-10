"use client";

import { BentoTile, MonoLabel, Pill } from "@/components/ui";
import {
  useGitlabOpenMRs,
  useGitlabReviewRequests,
  useGithubOpenPulls,
  useGithubReviewRequests,
  useIntegrations,
} from "@/features/integrations";
import { fmtRelative } from "@/lib/fmt";

export function PRsTile() {
  const { isConnected } = useIntegrations();
  const anyConnected = isConnected("gitlab") || isConnected("github");

  const { data: glMine } = useGitlabOpenMRs();
  const { data: glReview } = useGitlabReviewRequests();
  const { data: ghMine } = useGithubOpenPulls();
  const { data: ghReview } = useGithubReviewRequests();

  const mine = normalizeMine([
    ...(glMine || []).map(glToItem),
    ...(ghMine?.items || []).map(ghToItem),
  ]);
  const review = normalizeReview([
    ...(glReview || []).map(glToItem),
    ...(ghReview?.items || []).map(ghToItem),
  ]);

  return (
    <BentoTile
      col="span 5"
      row="span 3"
      label={`Pull requests · ${mine.length} yours · ${review.length} to review`}
      title="Open PRs"
      titleSize={18}
    >
      {!anyConnected ? (
        <div className="flex h-full items-center justify-center text-[13px] text-muted-fg">
          Connect GitLab or GitHub.
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-2 gap-2.5">
          <PRBlock heading="Yours" items={mine} kind="mine" />
          <PRBlock heading="Awaiting your review" items={review} kind="review" />
        </div>
      )}
    </BentoTile>
  );
}

function PRBlock({ heading, items, kind }) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-1 flex items-center gap-2">
        <MonoLabel>{heading}</MonoLabel>
        <span className="h-px flex-1 bg-border" />
        <span
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          {items.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <div className="text-[12px] text-dim-fg">Nothing here — nice.</div>
        ) : (
          items.map((m) => (
            <a
              key={m.id}
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="grid shrink-0 grid-cols-[44px_1fr_auto] items-center gap-2 border-b border-border border-dashed px-2 py-1.5 hover:bg-card-alt"
            >
              <span
                className="font-bold text-accent"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
              >
                {m.num}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium">{m.title}</div>
                <div
                  className="text-dim-fg"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
                >
                  {m.repo} ·{" "}
                  {kind === "mine"
                    ? `${m.rounds ?? 0} rounds · ${m.age}`
                    : `${m.author} · ${m.age}`}
                </div>
              </div>
              {kind === "mine" ? (
                <Pill tone={pipelineTone(m)} mono>
                  {m.draft ? "DRAFT" : (m.pipeline || "PENDING").toUpperCase()}
                </Pill>
              ) : (
                <Pill tone="accent" mono>
                  REVIEW
                </Pill>
              )}
            </a>
          ))
        )}
      </div>
    </div>
  );
}

function pipelineTone(m) {
  if (m.draft) return "muted";
  if (m.pipeline === "pass") return "ok";
  if (m.pipeline === "fail") return "warn";
  return "muted";
}

function glToItem(mr) {
  return {
    id: `gl-${mr.id}`,
    num: `!${mr.iid}`,
    source: "GitLab",
    url: mr.web_url,
    title: mr.title,
    repo: mr.references?.full?.split("!")[0].replace(/\/$/, "") || "gitlab",
    rounds: mr.user_notes_count ?? 0,
    author: mr.author?.username,
    age: fmtRelative(mr.updated_at),
    draft: !!mr.draft,
    pipeline: undefined, // would need /pipelines lookup per MR; left blank
  };
}

function ghToItem(pr) {
  return {
    id: `gh-${pr.id}`,
    num: `#${pr.number}`,
    source: "GitHub",
    url: pr.html_url,
    title: pr.title,
    repo: pr.repository_url?.split("/").slice(-2).join("/") || "github",
    rounds: pr.comments ?? 0,
    author: pr.user?.login,
    age: fmtRelative(pr.updated_at),
    draft: !!pr.draft,
    pipeline: undefined,
  };
}

function normalizeMine(items) {
  return items;
}
function normalizeReview(items) {
  return items;
}
