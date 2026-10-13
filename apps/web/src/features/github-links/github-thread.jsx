"use client";

/**
 * <GithubThread comments posts issueUrl /> — the GitHub half of the 1:1
 * thread, read-only: the developer's replies on the linked issue (author,
 * when, the text as plain text with its line breaks, a link out) and a
 * "Posted to GitHub" row for each note / grade eSpace put there.
 *
 * Bodies are NEVER rendered as markdown or HTML — they come from GitHub
 * and are shown as text.
 */

import { ExternalLink } from "lucide-react";
import { Badge, relativeAgo } from "@/components/ui";
import { shortDate } from "@/lib/date";
import { cn } from "@/lib/cn";
import { postKindLabel, threadItems } from "./link-model";

export function GithubThread({ comments, posts, issueUrl, className, emptyText }) {
  const items = threadItems(comments, posts);
  if (items.length === 0) {
    return emptyText ? (
      <p className={cn("text-[12px] leading-snug text-muted-fg", className)}>{emptyText}</p>
    ) : null;
  }
  return (
    <ol className={cn("flex flex-col gap-1.5", className)}>
      {items.map((it) =>
        it.type === "reply" ? (
          <Reply key={it.key} comment={it.comment} />
        ) : (
          <PostRow key={it.key} post={it.post} issueUrl={issueUrl} />
        ),
      )}
    </ol>
  );
}

function Reply({ comment }) {
  const at = Date.parse(comment.createdAt);
  return (
    <li className="rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="truncate text-[12px] font-bold text-fg">@{comment.author}</span>
        <span className="text-[11px] text-muted-fg" title={comment.createdAt}>
          {Number.isFinite(at) ? relativeAgo(at) : ""}
        </span>
        {comment.url ? (
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-muted-fg hover:text-fg"
            aria-label={`Open @${comment.author}'s comment on GitHub`}
          >
            GitHub <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg">
        {comment.body}
      </p>
    </li>
  );
}

function PostRow({ post, issueUrl }) {
  const href = issueUrl && post.commentId ? `${issueUrl}#issuecomment-${post.commentId}` : null;
  return (
    <li className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2">
      <Badge tone="lav">Posted to GitHub</Badge>
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-fg">
        {postKindLabel(post.kind)}
        {post.postedAt ? ` · ${shortDate(post.postedAt)}` : ""}
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-fg hover:text-fg"
          aria-label="Open the posted comment on GitHub"
        >
          View <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}
