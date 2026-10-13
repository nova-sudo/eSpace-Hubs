/**
 * Pure read-side model for a GitHub issue link (`PublicLink` from
 * /api/v1/github-links). No React, no IO — what a chip says, how fresh a
 * sync is, and which link belongs to which period. Tested under node.
 */

import { shortDate } from "@/lib/date";
import { relativeAgo } from "@/components/ui/live-value-state";

/** `owner/name` — a GitHub repo slug, and nothing GitLab-shaped (3+ segments). */
export const REPO_SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function isGithubRepoSlug(s) {
  return typeof s === "string" && REPO_SLUG_RE.test(s.trim());
}

/** A link that still points at an issue (pending / linked / failed). */
export function isActiveLink(link) {
  return Boolean(link) && link.status !== "unlinked";
}

function issueRef(link) {
  if (!link?.repo || !link?.issueNumber) return null;
  return `${link.repo}#${link.issueNumber}`;
}

/**
 * What the chip says. `tone` is one of the Badge tints — neutral / sky /
 * mint / lemon / peach — so state is carried by the design system's own
 * vocabulary, and `title` is the tooltip that spells out the ref + freshness.
 */
export function chipState(link, now = Date.now()) {
  if (!link || link.status === "unlinked") {
    return { tone: "neutral", label: "Not on GitHub", title: "This period has no GitHub issue." };
  }
  const ref = issueRef(link);
  const fresh = freshnessLabel(link, now);
  const suffix = [ref, fresh].filter(Boolean).join(" · ");
  const withRef = (text) => (suffix ? `${text} (${suffix})` : text);

  if (link.status === "pending") {
    return { tone: "lemon", label: "Publishing…", title: "eSpace is creating this issue on GitHub." };
  }
  if (link.status === "failed") {
    return {
      tone: "peach",
      label: "Publish failed",
      title: link.lastSyncError
        ? `Publishing failed: ${link.lastSyncError}. Republish to try again.`
        : "Publishing failed. Republish to try again.",
    };
  }
  if (link.lastSyncError === "integration_needs_reconnect") {
    return {
      tone: "lemon",
      label: "Reconnect GitHub",
      title: withRef("GitHub rejected the saved token. Reconnect it in Settings to keep syncing"),
    };
  }
  const state = link.state;
  if (state?.issueState === "missing") {
    return {
      tone: "peach",
      label: "Issue not found",
      title: withRef("The issue was deleted or moved on GitHub. Republish it or unlink this period"),
    };
  }
  if (state?.issueState === "closed") {
    if (state.stateReason === "not_planned") {
      return {
        tone: "neutral",
        label: "Closed · not planned",
        title: withRef("Closed on GitHub as not planned — the period is not logged as done"),
      };
    }
    const when = state.closedAt ? shortDate(state.closedAt) : "";
    return {
      tone: "mint",
      label: when ? `Closed on GitHub ${when}` : "Closed on GitHub",
      title: withRef("Closed on GitHub — logged as a completed period"),
    };
  }
  const tasks = state?.tasks;
  const total = Number(tasks?.total) || 0;
  const done = Number(tasks?.done) || 0;
  return {
    tone: "sky",
    label: total > 0 ? `Open on GitHub · ${done}/${total} tasks` : "Open on GitHub",
    title: withRef("Open on GitHub — closing the issue logs this period as done"),
  };
}

export function isStale(link) {
  return Boolean(link?.stale);
}

/** "synced 5 min ago" · "never synced". */
export function freshnessLabel(link, now = Date.now()) {
  const at = link?.lastSyncedAt ? Date.parse(link.lastSyncedAt) : NaN;
  if (!Number.isFinite(at)) return "never synced";
  return `synced ${relativeAgo(at, now)}`;
}

/**
 * The link for one positional period. An active link wins over an unlinked
 * one for the same index (a period can be unlinked and published again).
 */
export function findLink(links, periodIndex) {
  if (!Array.isArray(links) || !Number.isInteger(periodIndex)) return null;
  const mine = links.filter((l) => l && l.periodIndex === periodIndex);
  return mine.find(isActiveLink) || mine[0] || null;
}

/** Counts for a "3 published · 1 closed" style summary. */
export function summarizeLinks(links) {
  const out = { published: 0, closed: 0, open: 0, missing: 0 };
  for (const l of Array.isArray(links) ? links : []) {
    if (!isActiveLink(l)) continue;
    out.published += 1;
    const s = l.state?.issueState;
    if (s === "closed") out.closed += 1;
    else if (s === "open") out.open += 1;
    else if (s === "missing") out.missing += 1;
  }
  return out;
}

/** Every link's last sync is newer than `maxAgeMs` — nothing to re-read. */
export function allSyncedWithin(links, maxAgeMs, now = Date.now()) {
  const active = (Array.isArray(links) ? links : []).filter(isActiveLink);
  if (active.length === 0) return true;
  return active.every((l) => {
    const at = l.lastSyncedAt ? Date.parse(l.lastSyncedAt) : NaN;
    return Number.isFinite(at) && now - at < maxAgeMs;
  });
}

/** "2 min" / "1 min" — the wait a rate-limit toast names. */
export function retryMinutes(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.ceil(n / 60_000));
}

/** Toast copy for a publish failure, by the API's error code. */
export function publishErrorCopy(err) {
  const code = String(err?.code || "");
  switch (code) {
    case "integration_not_connected":
      return "Connect GitHub in Settings to publish.";
    case "integration_needs_reconnect":
      return "GitHub rejected the saved token — reconnect it in Settings and try again.";
    case "github_not_publishable":
      return "This tracker can't be published: it needs an approved plan with at least one period.";
    case "github_publish_in_progress":
      return "A publish is already running for this tracker — give it a moment.";
    case "rate_limited":
      return `GitHub is rate-limiting requests — try again in ${retryMinutes(err?.retryAfterMs)} min.`;
    case "github_target_missing":
      return "That repository wasn't found, or your GitHub account can't open issues there.";
    case "github_upstream_error":
      return "GitHub didn't answer properly. Try again in a moment.";
    default:
      return err?.message || "Couldn't publish to GitHub.";
  }
}

// ─── linked PRs + the GitHub thread (Phase 3) ────────────────────────

const PR_TONE = { merged: "mint", open: "sky", closed: "neutral" };
const PR_LABEL = { merged: "Merged", open: "Open", closed: "Closed" };

/** Badge tint for a linked PR's state: merged → mint, open → sky, closed → neutral. */
export function prTone(state) {
  return PR_TONE[state] || "neutral";
}

export function prStateLabel(state) {
  return PR_LABEL[state] || "Unknown";
}

/**
 * The evidence id a merged PR is starred under. Matches the merged-PR
 * feed exactly — `mr-` + the normaliser's `gh-<id>`
 * (integrations/api-clients/github-normalize.js) — and `prId` is the PR's
 * ISSUE id (what the search API returns), so a PR starred from either
 * place is one star.
 */
export function prEvidenceId(pr) {
  return pr && pr.prId != null ? `mr-gh-${pr.prId}` : null;
}

/** The starred-evidence item for a merged PR (same shape as the picker's). */
export function prEvidenceItem(pr) {
  const id = prEvidenceId(pr);
  if (!id) return null;
  return {
    id,
    kind: "merged-pr",
    ref: `!${pr.number}`,
    title: pr.title || "",
    date: pr.mergedAt ? shortDate(pr.mergedAt) : "",
    impact: "",
  };
}

/**
 * Every linked PR across links, deduped by prId, merged first then newest
 * merge first, each tagged with the period(s) it was linked from.
 */
export function collectLinkedPrs(links) {
  const byId = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    if (!isActiveLink(l)) continue;
    for (const pr of Array.isArray(l.state?.linkedPrs) ? l.state.linkedPrs : []) {
      if (!pr || pr.prId == null) continue;
      const prev = byId.get(pr.prId);
      if (prev) {
        if (l.periodLabel && !prev.periods.includes(l.periodLabel)) prev.periods.push(l.periodLabel);
        continue;
      }
      byId.set(pr.prId, { ...pr, goalId: l.goalId, periods: l.periodLabel ? [l.periodLabel] : [] });
    }
  }
  const rank = { merged: 0, open: 1, closed: 2 };
  return [...byId.values()].sort((a, b) => {
    const r = (rank[a.state] ?? 3) - (rank[b.state] ?? 3);
    if (r !== 0) return r;
    return (Date.parse(b.mergedAt || "") || 0) - (Date.parse(a.mergedAt || "") || 0);
  });
}

/**
 * The thread as one timeline, oldest first: developer replies
 * (`type: "reply"`) and eSpace's own posts (`type: "post"`).
 */
export function threadItems(comments, posts) {
  const out = [];
  for (const c of Array.isArray(comments) ? comments : []) {
    out.push({ type: "reply", key: `c-${c.commentId}`, at: Date.parse(c.createdAt) || 0, comment: c });
  }
  for (const p of Array.isArray(posts) ? posts : []) {
    out.push({ type: "post", key: `p-${p.kind}-${p.sourceId}`, at: Date.parse(p.postedAt) || 0, post: p });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** "Tier verdict" / "1:1 note" — what an eSpace post was. */
export function postKindLabel(kind) {
  return kind === "tier_verdict" ? "Tier verdict" : kind === "manager_note" ? "1:1 note" : "Post";
}

/** Has this (kind, sourceId) already been posted on the link? */
export function hasPost(link, kind, sourceId) {
  return (Array.isArray(link?.posts) ? link.posts : []).some(
    (p) => p.kind === kind && p.sourceId === sourceId,
  );
}

/**
 * The link a grade should be posted to by default: the most recently
 * closed period, else the first open one, else the first linked one.
 */
export function defaultGradeLink(links) {
  const linked = (Array.isArray(links) ? links : []).filter(
    (l) => isActiveLink(l) && l.status === "linked" && l.issueNumber,
  );
  if (linked.length === 0) return null;
  const closed = linked
    .filter((l) => l.state?.issueState === "closed")
    .sort((a, b) => (Date.parse(b.state?.closedAt || "") || 0) - (Date.parse(a.state?.closedAt || "") || 0));
  if (closed[0]) return closed[0];
  return linked.find((l) => l.state?.issueState === "open") || linked[0];
}

/** "acme/app#12 · January" — a picker label for a link. */
export function linkOptionLabel(link) {
  const ref = link?.repo && link?.issueNumber ? `${link.repo}#${link.issueNumber}` : "Issue";
  return link?.periodLabel ? `${link.periodLabel} · ${ref}` : ref;
}

// ─── correlation report (Phase 4) ────────────────────────────────────

/** Display order of the gap flags — most urgent first. */
export const CORRELATION_FLAGS = [
  "closed_no_evidence",
  "issue_missing",
  "open_past_deadline",
  "evidence_no_issue",
  "stale_period",
];

const FLAG_COPY = {
  closed_no_evidence: {
    tone: "peach",
    label: "No evidence",
    title: "Closed on GitHub, but nothing logged here: no evidence text, file or merged pull request.",
  },
  issue_missing: {
    tone: "peach",
    label: "Issue missing",
    title: "The issue was deleted or moved on GitHub. Republish it or unlink this period.",
  },
  open_past_deadline: {
    tone: "peach",
    label: "Past due",
    title: "Still open on GitHub after this period's due date.",
  },
  evidence_no_issue: {
    tone: "lemon",
    label: "Not on GitHub",
    title: "Logged here, but this period has no GitHub issue.",
  },
  stale_period: {
    tone: "lemon",
    label: "Plan changed",
    title: "The plan changed after this period was published. Republish to bring the issue up to date.",
  },
};

/** Badge copy for one gap flag: `{ tone, label, title }`. Unknown flags read neutral. */
export function flagCopy(flag) {
  return FLAG_COPY[flag] || { tone: "neutral", label: String(flag || "Flag"), title: "" };
}

/** Counts per flag across every goal's periods, plus `periods` and `flagged` totals. */
export function correlationSummary(goals) {
  const out = { periods: 0, flagged: 0 };
  for (const f of CORRELATION_FLAGS) out[f] = 0;
  for (const g of Array.isArray(goals) ? goals : []) {
    for (const p of Array.isArray(g?.periods) ? g.periods : []) {
      out.periods += 1;
      const flags = Array.isArray(p?.flags) ? p.flags : [];
      if (flags.length) out.flagged += 1;
      for (const f of flags) out[f] = (out[f] ?? 0) + 1;
    }
  }
  return out;
}

const SUMMARY_PHRASES = {
  closed_no_evidence: ["period closed on GitHub without evidence", "periods closed on GitHub without evidence"],
  issue_missing: ["issue missing on GitHub", "issues missing on GitHub"],
  open_past_deadline: ["issue still open past its due date", "issues still open past their due date"],
  evidence_no_issue: ["logged period not on GitHub", "logged periods not on GitHub"],
  stale_period: ["period published before a plan change", "periods published before a plan change"],
};

/**
 * The report's headline: "3 periods closed on GitHub without evidence ·
 * 1 issue missing on GitHub", or a calm line when nothing is flagged.
 */
export function correlationSummaryLine(summary) {
  if (!summary || !summary.periods) return "";
  const parts = [];
  for (const f of CORRELATION_FLAGS) {
    const n = summary[f] || 0;
    if (!n) continue;
    const [one, many] = SUMMARY_PHRASES[f];
    parts.push(`${n} ${n === 1 ? one : many}`);
  }
  if (parts.length === 0) return "GitHub and eSpace agree on every published period.";
  return parts.join(" · ");
}

/**
 * A correlation period's issue as the `PublicLink` shape `GithubIssueChip`
 * reads, so the report reuses the one chip. Null when the period has no link.
 */
export function correlationChipLink(issue) {
  if (!issue) return null;
  return {
    id: issue.linkId,
    status: issue.linkStatus || "linked",
    repo: issue.repo,
    issueNumber: issue.number,
    issueUrl: issue.url,
    stale: Boolean(issue.stale),
    lastSyncedAt: issue.lastSyncedAt,
    lastSyncError: null,
    state: issue.state
      ? {
          issueState: issue.state,
          stateReason: issue.stateReason,
          closedAt: issue.closedAt,
          tasks: issue.tasks || { done: 0, total: 0 },
        }
      : null,
  };
}

/** "1/2 merged" for a period's linked PRs, or "—". */
export function prCountLabel(prs) {
  const list = Array.isArray(prs) ? prs : [];
  if (list.length === 0) return "—";
  const merged = list.filter((p) => p?.state === "merged").length;
  return `${merged}/${list.length} merged`;
}

/** "Logged Jan 5" · "From GitHub Jan 20" · "—". */
export function readingLabel(reading) {
  if (!reading?.at) return "—";
  const when = shortDate(reading.at);
  return reading.source === "github" ? `From GitHub ${when}` : `Logged ${when}`;
}
