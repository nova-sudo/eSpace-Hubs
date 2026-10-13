"use client";

/**
 * <LinkedPrs link prs onStar isStarred /> — the pull requests a GitHub
 * issue links to, as evidence: a state badge (merged mint · open sky ·
 * closed neutral), the title linking out, the author and the merge date.
 *
 * Starring is the caller's business: this is a shared domain and the
 * evidence store lives in a product surface, so a surface that can star
 * passes `onStar(pr)` + `isStarred(pr)`; without `onStar` there is no star
 * button. Only merged PRs are starrable (evidence kind "merged-pr").
 *
 * `prs` overrides `link.state.linkedPrs` (a cross-link list from
 * `collectLinkedPrs`). Renders nothing when there are no PRs.
 */

import { useState } from "react";
import { Badge, StarGlyph } from "@/components/ui";
import { shortDate } from "@/lib/date";
import { cn } from "@/lib/cn";
import { prStateLabel, prTone } from "./link-model";

export function LinkedPrs({ link, prs, onStar, isStarred, className, showPeriods = false }) {
  const list = Array.isArray(prs) ? prs : Array.isArray(link?.state?.linkedPrs) ? link.state.linkedPrs : [];
  if (list.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {list.map((pr) => (
        <PrRow
          key={pr.prId ?? `${pr.repo}#${pr.number}`}
          pr={pr}
          onStar={onStar}
          starred={Boolean(isStarred?.(pr))}
          showPeriods={showPeriods}
        />
      ))}
    </ul>
  );
}

function PrRow({ pr, onStar, starred, showPeriods }) {
  const [busy, setBusy] = useState(false);
  const canStar = Boolean(onStar) && pr.state === "merged";
  const meta = [
    pr.author ? `@${pr.author}` : null,
    pr.mergedAt ? `merged ${shortDate(pr.mergedAt)}` : null,
    showPeriods && Array.isArray(pr.periods) && pr.periods.length ? pr.periods.join(", ") : null,
  ].filter(Boolean);

  async function star() {
    if (busy) return;
    setBusy(true);
    try {
      await onStar(pr);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-2.5 rounded-[var(--radius-lg)] bg-card-alt px-3 py-2">
      <Badge tone={prTone(pr.state)} className="shrink-0">
        {prStateLabel(pr.state)}
      </Badge>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-[11.5px] text-muted-fg">#{pr.number}</span>
          {pr.url ? (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate text-[13px] font-semibold text-fg hover:underline"
              title={`${pr.repo}#${pr.number} — ${pr.title}`}
            >
              {pr.title || "(untitled pull request)"}
            </a>
          ) : (
            <span className="truncate text-[13px] font-semibold text-fg">{pr.title}</span>
          )}
        </span>
        {meta.length ? (
          <span className="block truncate text-[11.5px] text-muted-fg">{meta.join(" · ")}</span>
        ) : null}
      </span>
      {canStar ? (
        <button
          type="button"
          onClick={star}
          disabled={busy}
          aria-pressed={starred}
          aria-label={starred ? `Remove #${pr.number} from starred proof` : `Star #${pr.number} as proof`}
          title={starred ? "Starred as proof" : "Star as proof"}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
        >
          <StarGlyph on={starred} />
        </button>
      ) : null}
    </li>
  );
}
