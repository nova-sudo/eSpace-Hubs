"use client";

/**
 * PR review log — the deep-dive page behind the dashboard's review-timing
 * section. Lists every reviewed PR in the active date window, expanded
 * with full timing breakdown, comment threads, and (for review-line
 * comments) the code snippet they were anchored to.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [hero / page header]                                       │
 *   │ ┌──── PRs list (left) ────┐ ┌──── PR detail (right) ────┐ │
 *   │ │ #14 Auth refactor   3d  │ │  #14 · Auth refactor       │ │
 *   │ │ #11 Migrate cache  18h  │ │  TTFR 2h · ATTNR 6h · 3 reviewers
 *   │ │ #6  Wire telemetry  4h  │ │                            │ │
 *   │ │ #3  Fix race        1h  │ │  ▶ alice on src/lib/x.js    │
 *   │ └─────────────────────────┘ │     ```                    │ │
 *   │                             │     diff hunk              │ │
 *   │                             │     ```                    │ │
 *   │                             │     "review comment text"  │ │
 *   │                             └────────────────────────────┘ │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Selecting a PR is `?pr=<id>` so the dashboard tile can deep-link
 * straight into a specific PR's detail. Without a query param we default
 * to the first PR.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";
import { ExternalLink } from "lucide-react";
import { DrillDownNav } from "@/components/shell/drill-down-nav";
import { Badge, Button, Card, Label, PageHeader, Stat } from "@/components/ui";
import { toast } from "sonner";
import { AI_PROVIDERS, useAiProvider } from "@/features/analyst";
import { cn } from "@/lib/cn";
import {
  fmtMs,
  usePrReviewTimings,
  useIntegrations,
} from "@/features/integrations";
import { useDateRange, DateRangeToolbar, splitByRange } from "@/features/date-range";
import { useHubLink } from "@/features/hubs";
import { fullDate } from "@/lib/date";

/** What the timing acronyms mean — shown as a legend and as tooltips. */
const TIMING_LEGEND = {
  TTFR: "Time to first review — from the PR opening to the first reviewer comment.",
  ATTNR:
    "Average time to next review — the mean gap between one review round and the next (needs two or more rounds).",
  Idle: "Total time the PR sat waiting on reviewers: TTFR plus every later gap.",
};

/** Revalidate the review-timing SWR entries — the hook has no `mutate`,
 *  but its keys are prefixed, so a key filter reaches them. */
function useRetryReviewTimings() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith("pr-review-timings:"),
        undefined,
        { revalidate: true },
      ),
    [mutate],
  );
}

export function PrReviewsPage() {
  const { range } = useDateRange();
  const { data: timings, isLoading, error } = usePrReviewTimings(range.fetchSince);
  const retry = useRetryReviewTimings();
  const link = useHubLink();
  const { isConnected } = useIntegrations();
  const hasCodeHost = isConnected("github") || isConnected("gitlab");
  const inWindow = useMemo(
    () =>
      splitByRange(timings || [], range, (t) => t.pr?.mergedAt || t.pr?.createdAt)
        .current,
    [timings, range],
  );

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState(null);
  // `?pr=` is applied ONCE, on mount — it used to lock the selection so
  // every click snapped back to the deep-linked PR.
  const initialRequestRef = useRef(searchParams.get("pr"));

  // Default to the first PR when none picked, or honour the deep-link once.
  useEffect(() => {
    if (inWindow.length === 0) {
      setSelectedId(null);
      return;
    }
    const requested = initialRequestRef.current;
    if (requested && inWindow.some((t) => String(t.pr.id) === String(requested))) {
      initialRequestRef.current = null;
      setSelectedId(requested);
      return;
    }
    if (selectedId == null || !inWindow.some((t) => String(t.pr.id) === String(selectedId))) {
      setSelectedId(inWindow[0].pr.id);
    }
  }, [inWindow, selectedId]);

  // Clicking a PR keeps the URL shareable: `?pr=` follows the selection.
  const selectPr = useCallback(
    (id) => {
      setSelectedId(id);
      const params = new URLSearchParams(searchParams.toString());
      params.set("pr", String(id));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const selected = inWindow.find((t) => String(t.pr.id) === String(selectedId));

  return (
    <main className="relative z-[2] px-4 sm:px-10 pb-14 pt-9">
      <PageHeader
        crumb={
          inWindow.length > 0
            ? `Review log · ${inWindow.length} PR${inWindow.length === 1 ? "" : "s"} · ${range.label.toLowerCase()}`
            : "Review log · no PRs in this window"
        }
        title="Where review time goes."
        subtitle="Every reviewed PR in the window — time to first review, the gap between rounds, total idle time, and the comment threads that drove each round. Line comments show the code they were left on."
      />
      <DrillDownNav className="-mt-2 mb-7" />

      <div className="-mx-4 mb-5 sm:-mx-10">
        <DateRangeToolbar />
      </div>

      {!hasCodeHost ? (
        <Empty
          label="Connect GitHub or GitLab to see your review log."
          body="Review timings come from your merged PRs' comment threads — there's nothing to read until a code host is connected."
          action={
            <Button as={Link} href={link("/settings?tab=integrations")}>Connect GitHub or GitLab</Button>
          }
        />
      ) : isLoading && inWindow.length === 0 ? (
        <Empty label="Loading review timings…" />
      ) : error ? (
        <Empty
          label="Couldn't load review data."
          body={error.message || String(error)}
          action={
            <Button onClick={() => void retry()}>Retry</Button>
          }
        />
      ) : inWindow.length === 0 ? (
        <Empty
          label="No reviewed PRs in this window."
          body="Only PRs that were merged (or opened) inside the selected range appear here — try a wider range."
        />
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)" }}
        >
          <PrList
            items={inWindow}
            selectedId={selectedId}
            onSelect={selectPr}
          />
          {selected ? <PrDetail item={selected} onRetry={retry} /> : null}
        </div>
      )}
    </main>
  );
}

function Empty({ label, body, action }) {
  return (
    <Card className="px-4 sm:px-10 py-16 text-center">
      <Label>Review log</Label>
      <h2 className="mx-auto mt-3 max-w-[520px] text-[18px] font-bold tracking-[-0.01em] text-fg">
        {label}
      </h2>
      {body ? (
        <p className="mx-auto mt-2 max-w-[480px] text-[13px] leading-[1.5] text-muted-fg">{body}</p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </Card>
  );
}

function providerName(source) {
  return source === "gitlab" ? "GitLab" : "GitHub";
}

/* ─────────────────────────── PR list ─────────────────────────── */

function PrList({ items, selectedId, onSelect }) {
  return (
    <Card padding={0} className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <Label>PRs · sorted by total idle</Label>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {[...items]
          .sort((a, b) => (b.timing?.idle || 0) - (a.timing?.idle || 0))
          .map((it) => (
            <PrListItem
              key={it.pr.id}
              item={it}
              active={String(it.pr.id) === String(selectedId)}
              onSelect={() => onSelect(it.pr.id)}
            />
          ))}
      </div>
    </Card>
  );
}

function PrListItem({ item, active, onSelect }) {
  const t = item.timing;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "block w-full cursor-pointer border-t border-line px-4 py-3 text-left first:border-t-0 hover:bg-card-alt",
        active && "bg-card-alt",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[12px] font-bold text-fg">#{item.pr.number}</span>
        <span className="text-[11.5px] text-muted-fg">
          {item.pr.mergedAt ? fullDate(item.pr.mergedAt) : "—"}
        </span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-[1.35] text-fg">
        {item.pr.title || "(no title)"}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-muted-fg">
        <span>{item.pr.repo}</span>
        <span>
          idle {fmtMs(t?.idle || 0)} · {t?.reviewCount || 0} review
          {t?.reviewCount === 1 ? "" : "s"}
        </span>
      </div>
    </button>
  );
}

/* ─────────────────────────── PR detail ─────────────────────────── */

function PrDetail({ item, onRetry }) {
  const { pr, details, timing } = item;
  const [retrying, setRetrying] = useState(false);
  async function retryDetails() {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry?.();
    } finally {
      setRetrying(false);
    }
  }
  // Comments sorted by timestamp so the timeline reads chronologically.
  const orderedComments = useMemo(() => {
    const arr = (details?.comments || [])
      .filter((c) => c?.createdAt)
      .map((c) => ({ ...c, _ts: Date.parse(c.createdAt) }))
      .filter((c) => Number.isFinite(c._ts))
      .sort((a, b) => a._ts - b._ts);
    return arr;
  }, [details]);

  return (
    <Card padding={0} className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <Label>{pr.repo}</Label>
            <span className="font-mono text-[12px] font-bold text-fg">#{pr.number}</span>
            {pr.author ? (
              <span className="text-[11px] text-muted-fg">by @{pr.author}</span>
            ) : null}
          </div>
          <h2 className="mt-1.5 text-[18px] font-bold tracking-[-0.01em] leading-[1.2] text-fg">
            {pr.title || details?.title || "(no title)"}
          </h2>
          <div className="mt-1.5 text-[12px] text-muted-fg">
            {pr.createdAt ? `opened ${fullDate(pr.createdAt)}` : null}
            {pr.mergedAt ? ` · merged ${fullDate(pr.mergedAt)}` : null}
          </div>
        </div>
        {pr.htmlUrl ? (
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-bold text-fg hover:underline"
          >
            View on {providerName(pr.source)} <ExternalLink size={13} />
          </a>
        ) : null}
      </div>

      {/* Timing summary band */}
      <div className="border-b border-line px-5 py-4">
        <div className="grid grid-cols-4 gap-3">
          <div title={TIMING_LEGEND.TTFR}>
            <Stat label="TTFR" value={fmtMs(timing?.ttfr)} sub="time to first review" />
          </div>
          <div title={TIMING_LEGEND.ATTNR}>
            <Stat label="ATTNR" value={fmtMs(timing?.attnr)} sub="avg. gap between rounds" />
          </div>
          <div title={TIMING_LEGEND.Idle}>
            <Stat label="Idle (Σ)" value={fmtMs(timing?.idle || 0)} sub="total waiting on review" />
          </div>
          <Stat
            label="Reviewers"
            value={timing?.reviewers?.length ? `${timing.reviewers.length}` : "0"}
            sub={(timing?.reviewers || []).slice(0, 3).join(", ")}
          />
        </div>
        <p className="mt-3 text-[11.5px] leading-[1.5] text-muted-fg">
          TTFR — {TIMING_LEGEND.TTFR} ATTNR — {TIMING_LEGEND.ATTNR}
        </p>
      </div>

      {/* Per-round breakdown */}
      {timing && timing.reviewCount > 0 ? (
        <RoundBreakdown timing={timing} />
      ) : null}

      {/* Ad-hoc AI grading — fires only when the user asks for it. The
          full rubric-grading flow lives in /features/grading/ but this
          quick-grade just runs against a small built-in rubric so users
          can poke any PR without first defining a goal. */}
      <GradeBlock pr={pr} details={details} />


      {/* Comment thread */}
      <div className="px-5 py-4">
        <Label>Comments{details ? ` · ${orderedComments.length}` : ""}</Label>
        {!details ? (
          // `details: null` means the per-PR fetch failed, not that the PR
          // is comment-free — say so and offer a way back.
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-muted-fg">
            <span>Couldn&apos;t load this PR&apos;s comments.</span>
            <Button size="sm" variant="soft" onClick={() => void retryDetails()} disabled={retrying}>
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : orderedComments.length === 0 ? (
          <div className="mt-3 text-[13px] text-muted-fg">
            No comments on this PR.
          </div>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {orderedComments.map((c) => (
              <li key={c.id || c._ts}>
                <CommentCard comment={c} prAuthor={pr.author} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function RoundBreakdown({ timing }) {
  // Build the ordered round list: TTFR, then each TT2R/3R/...
  const segments = [];
  if (timing.ttfr != null) {
    segments.push({ label: "TTFR", ms: timing.ttfr });
  }
  timing.nthGaps.forEach((ms, i) => {
    segments.push({ label: `TT${i + 2}R`, ms });
  });
  if (segments.length === 0) return null;

  const max = segments.reduce((m, s) => Math.max(m, s.ms), 0);

  return (
    <div className="border-b border-line px-5 py-3.5">
      <Label>Time to each review round</Label>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {segments.map((s, i) => {
          const widthPct = max > 0 ? Math.max(2, (s.ms / max) * 100) : 0;
          return (
            <li
              key={i}
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: "60px 1fr 60px" }}
            >
              <span className="text-[11.5px] font-bold text-fg">{s.label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-track">
                <div className="h-full rounded-full bg-ink" style={{ width: `${widthPct}%` }} />
              </div>
              <span className="text-right text-[11.5px] text-muted-fg">{fmtMs(s.ms)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CommentCard({ comment, prAuthor }) {
  const isAuthor = prAuthor && comment.user === prAuthor;
  const isReview = comment.kind === "review";
  return (
    <div className="rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-bold text-fg">@{comment.user}</span>
          <Badge tone={isReview ? "lav" : "neutral"}>
            {isReview ? "Review · line comment" : "Conversation"}
            {isAuthor ? " · author" : ""}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-fg">
          {comment.createdAt ? fullDate(comment.createdAt) : ""}
        </span>
      </div>

      {/* Code snippet for review-line comments */}
      {isReview && comment.path ? (
        <div className="mt-2.5 overflow-hidden rounded-[var(--radius-md)] bg-card">
          <div className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-1.5 text-[11px] text-muted-fg">
            <span className="truncate font-mono" title={comment.path}>
              {comment.path}
              {comment.line ? `:${comment.line}` : ""}
            </span>
            {comment.htmlUrl ? (
              <a
                href={comment.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 font-bold text-fg hover:underline"
              >
                Open <ExternalLink size={12} />
              </a>
            ) : null}
          </div>
          {comment.diffHunk ? (
            <pre className="m-0 overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-[1.5]">
              {renderDiffHunk(comment.diffHunk)}
            </pre>
          ) : null}
        </div>
      ) : null}

      {/* Comment body */}
      {comment.body ? (
        <div
          className="mt-2.5 whitespace-pre-wrap text-[13px] leading-[1.55] text-fg"
          style={{ wordBreak: "break-word" }}
        >
          {comment.body}
        </div>
      ) : null}
    </div>
  );
}

/**
 * GradeBlock — quick AI grade for one PR.
 *
 * Uses a small built-in rubric (description clarity, reviewer concerns
 * addressed, no orphaned discussions) so the user can grade any PR
 * without defining a goal first. The full goal-rubric grading flow lives
 * in /features/grading/ and is the path used by CODE_RUBRIC widgets;
 * this is a quick-look complement, not a replacement.
 */
const QUICK_RUBRIC = [
  "PR title and description clearly explain what changed and why.",
  "Every reviewer concern in the comments has a visible resolution (a fix, an answer, or an explicit acknowledgement).",
  "No threads ended with 'I'll address this later' that weren't addressed.",
];

function GradeBlock({ pr, details }) {
  const { provider, aiHeaders } = useAiProvider();
  const providerLabel =
    AI_PROVIDERS.find((p) => p.id === provider)?.label || provider;
  const [verdict, setVerdict] = useState(null);
  const [grading, setGrading] = useState(false);
  // Reset verdict when the user moves to a different PR.
  const lastPrIdRef = useRef(null);
  useEffect(() => {
    if (lastPrIdRef.current !== pr?.id) {
      lastPrIdRef.current = pr?.id;
      setVerdict(null);
    }
  }, [pr?.id]);

  async function handleGrade() {
    if (!details) {
      toast.error("Comments haven't loaded for this PR yet.");
      return;
    }
    setGrading(true);
    try {
      const res = await fetch("/api/v1/ai/grade-pr", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...aiHeaders },
        body: JSON.stringify({
          provider,
          rubric: QUICK_RUBRIC,
          pr: {
            id: pr.id,
            title: pr.title || details.title || "",
            body: details.body || "",
            comments: details.comments || [],
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error?.message || body?.error || `${provider} ${res.status}`,
        );
      }
      setVerdict(body?.verdict || null);
    } catch (err) {
      toast.error(`Grading failed: ${err?.message || err}`);
    } finally {
      setGrading(false);
    }
  }

  return (
    <div className="border-b border-line bg-card-alt px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <Label>Quick AI grade</Label>
        <Button size="sm" variant={verdict ? "soft" : "ink"} onClick={handleGrade} disabled={grading}>
          {grading ? "Grading…" : verdict ? "Re-grade" : `Grade with ${providerLabel}`}
        </Button>
      </div>
      {verdict ? (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <Badge tone={verdict.pass ? "mint" : "peach"}>{verdict.pass ? "Pass" : "Needs work"}</Badge>
            <span className="text-[13.5px] text-fg">{verdict.reasoning}</span>
          </div>
          {Array.isArray(verdict.violations) && verdict.violations.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-[12px] text-peach-text">
              {verdict.violations.map((v, i) => (
                <li key={i}>· {v}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 text-[11.5px] text-muted-fg">
            Rubric: {QUICK_RUBRIC.length} built-in criteria. For grades that count
            toward a goal, set your own criteria on the goal&apos;s code-quality
            tracker on the Goals page.
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] leading-[1.45] text-muted-fg">
          Runs the PR body + every review comment through {providerLabel} against a
          tiny built-in rubric (description clarity · concerns addressed ·
          no orphan threads). Useful for deciding if a PR belongs in your
          evidence packet.
        </p>
      )}
    </div>
  );
}

/**
 * Render a unified-diff hunk with `+`/`-` lines tinted. We don't bother
 * with full syntax highlighting — diff hunks are usually short (a few
 * lines around the comment anchor) and the +/- distinction is the only
 * signal a reviewer needs to orient themselves.
 */
function renderDiffHunk(hunk) {
  const lines = hunk.split("\n");
  return lines.map((line, i) => {
    let cls = "text-fg";
    if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-mint-text";
    else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-peach-text";
    else if (line.startsWith("@@")) cls = "text-muted-fg";
    return (
      <span key={i} className={cn("block", cls)}>
        {line || " "}
      </span>
    );
  });
}
