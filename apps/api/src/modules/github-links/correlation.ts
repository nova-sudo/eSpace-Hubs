/**
 * The correlation report — both layers of a published goal side by side,
 * per period: what GitHub says (the issue, its linked PRs) and what eSpace
 * holds (the newest reading, evidence text, uploaded files, the grade),
 * with a flag wherever the two disagree.
 *
 * Pure: the controller loads every input with org-scoped, indexed reads
 * and hands them over; this file never touches a database. Periods come
 * from the same grid publish.ts uses (`assignedWindows` limited to the
 * authored periods, labelled by `resolvePeriodContent`), and an entry
 * belongs to a period by the shared `entryInWindow` rule — the one the
 * shared-goal status grid uses — so the three surfaces agree on "which
 * period was this logged for".
 *
 * Flags:
 *   closed_no_evidence  closed as completed on GitHub, but the period has
 *                       no evidence text, no uploaded file and no merged
 *                       (or starred) linked PR
 *   evidence_no_issue   the period has an entry or evidence but no live
 *                       link — only once the goal has a published period
 *   open_past_deadline  the issue is still open after the period's due day
 *   stale_period        the plan was re-keyed after publishing
 *   issue_missing       the issue was deleted or moved on GitHub
 */

import {
  assignedWindows,
  entryInWindow,
  resolvePeriodContent,
} from "@espace-devhub/shared/goal-specs";
import type { GithubLink, GoalTier } from "../../db/types.js";

const DAY = 86_400_000;
const LIVE = new Set(["pending", "linked", "failed"]);
const WHOLE_GOAL_TIER_KEY = "__goal__";

export const CORRELATION_FLAGS = [
  "closed_no_evidence",
  "evidence_no_issue",
  "open_past_deadline",
  "stale_period",
  "issue_missing",
] as const;
export type CorrelationFlag = (typeof CORRELATION_FLAGS)[number];

// ─── inputs ──────────────────────────────────────────────────────────

export interface CorrelationGoalInput {
  goalId: string;
  title: string;
  code: string | null;
  /** The goal's spec; null when it can no longer be resolved (periods then come from the links). */
  spec: Record<string, unknown> | null;
}

/** The slice of a goal_inputs row the report reads. */
export interface CorrelationEntry {
  goalId: string;
  ts: Date | string | number | null;
  createdAt?: Date | string | number | null;
  value: unknown;
  source?: string | null;
}

export interface CorrelationVerdict {
  goalId: string;
  periodKey: string;
  tier: GoalTier;
  gradedAt: Date | null;
}

export type CorrelationLink = Pick<
  GithubLink,
  | "_id"
  | "goalId"
  | "periodIndex"
  | "periodKey"
  | "periodLabel"
  | "repo"
  | "issueNumber"
  | "issueUrl"
  | "status"
  | "state"
  | "stale"
  | "lastSyncedAt"
>;

export interface BuildCorrelationArgs {
  goals: CorrelationGoalInput[];
  links: CorrelationLink[];
  inputs: CorrelationEntry[];
  managerVerdicts: CorrelationVerdict[];
  aiVerdicts: CorrelationVerdict[];
  /** Starred evidence ids of the goal owner (`mr-gh-<prId>` for a merged PR). */
  evidenceIds: Iterable<string>;
  /** goalId → file periodKey ("" for a goal-level file) → count. */
  evidenceFileCounts: Record<string, Record<string, number>>;
  now: Date;
}

// ─── output ──────────────────────────────────────────────────────────

export interface CorrelationIssue {
  number: number | null;
  url: string | null;
  state: "open" | "closed" | "missing" | null;
  stateReason: string | null;
  closedAt: string | null;
  tasks: { done: number; total: number };
  /** Extras so the client can draw the shared issue chip. */
  linkId: string;
  linkStatus: GithubLink["status"];
  repo: string;
  lastSyncedAt: string | null;
  stale: boolean;
}

export interface CorrelationPr {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed" | "merged";
  mergedAt: string | null;
}

export interface CorrelationPeriod {
  periodIndex: number;
  label: string;
  /** The period's due day (UTC midnight), or null when it has no known end. */
  deadline: string | null;
  issue: CorrelationIssue | null;
  linkedPrs: CorrelationPr[];
  reading: { at: string; source: string } | null;
  grade: { tier: GoalTier; by: "manager" | "ai" } | null;
  flags: CorrelationFlag[];
}

export interface CorrelationGoal {
  goalId: string;
  title: string;
  code: string | null;
  periods: CorrelationPeriod[];
}

// ─── helpers ─────────────────────────────────────────────────────────

function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

const iso = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString());

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Any non-blank evidence string on the entry (`value.evidence` is `{ fieldId: text }`). */
export function hasEvidenceText(entry: Pick<CorrelationEntry, "value">): boolean {
  const value = isObj(entry.value) ? entry.value : null;
  const ev = value?.evidence;
  if (typeof ev === "string") return ev.trim().length > 0;
  if (!isObj(ev)) return false;
  return Object.values(ev).some((t) => typeof t === "string" && t.trim().length > 0);
}

/** The period's file count: its own key, its nested keys, or "" for a single-window plan. */
function filesFor(counts: Record<string, number> | undefined, key: string | null): number {
  if (!counts) return 0;
  let n = 0;
  for (const [pk, c] of Object.entries(counts)) {
    if (!Number.isFinite(c) || c <= 0) continue;
    if (key == null ? pk === "" : pk === key || pk.startsWith(`${key}::`)) n += c;
  }
  return n;
}

function newest(verdicts: CorrelationVerdict[]): CorrelationVerdict | null {
  let best: CorrelationVerdict | null = null;
  for (const v of verdicts) {
    if (!best || (toMs(v.gradedAt) ?? 0) > (toMs(best.gradedAt) ?? 0)) best = v;
  }
  return best;
}

/**
 * A period's grade. Manager outranks AI. A keyed period takes the verdict
 * filed under its own key; a single-window plan (key null) takes the
 * manager's newest grade on the goal, else the AI's whole-goal verdict.
 */
function gradeFor(
  key: string | null,
  manager: CorrelationVerdict[],
  ai: CorrelationVerdict[],
): CorrelationPeriod["grade"] {
  const m = key == null ? newest(manager) : newest(manager.filter((v) => v.periodKey === key));
  if (m) return { tier: m.tier, by: "manager" };
  const a = newest(ai.filter((v) => v.periodKey === (key ?? WHOLE_GOAL_TIER_KEY)));
  return a ? { tier: a.tier, by: "ai" } : null;
}

/** The link that represents a period: a linked row beats a pending / failed one. */
function pickLink(links: CorrelationLink[]): CorrelationLink | null {
  const rank = (l: CorrelationLink) => (l.status === "linked" ? 0 : l.status === "pending" ? 1 : 2);
  return [...links].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function issueOf(link: CorrelationLink): CorrelationIssue {
  const s = link.state;
  return {
    number: link.issueNumber ?? null,
    url: link.issueUrl ?? null,
    state: s?.issueState ?? null,
    stateReason: s?.stateReason ?? null,
    closedAt: iso(toMs(s?.closedAt)),
    tasks: { done: s?.tasks?.done ?? 0, total: s?.tasks?.total ?? 0 },
    linkId: link._id.toHexString(),
    linkStatus: link.status,
    repo: link.repo,
    lastSyncedAt: iso(toMs(link.lastSyncedAt)),
    stale: Boolean(link.stale),
  };
}

interface PeriodFrame {
  index: number;
  key: string | null;
  label: string;
  start: number;
  end: number;
  /** Exclusive end of the due day; null when unknown. */
  dueEnd: number | null;
}

/**
 * The period grid publish.ts uses: cycle windows covered by an authored
 * period. Any linked index outside that grid (the plan shrank after
 * publishing) is appended from the link itself, so no link drops off.
 */
function framesFor(
  spec: Record<string, unknown> | null,
  links: CorrelationLink[],
  nowMs: number,
): PeriodFrame[] {
  const frames: PeriodFrame[] = [];
  const composed = isObj(spec?.composed) ? (spec!.composed as Record<string, unknown>) : null;
  const authored = Array.isArray(composed?.periods) ? (composed!.periods as unknown[]).length : 0;
  if (spec && authored > 0) {
    for (const w of assignedWindows(spec, nowMs)) {
      if (w.index >= authored) continue;
      const content = resolvePeriodContent(spec, w.index) as { label?: unknown; dueAt?: unknown };
      const label =
        (typeof content.label === "string" && content.label) || w.label || `Period ${w.index + 1}`;
      const dueDay =
        typeof content.dueAt === "string" ? Date.parse(content.dueAt.trim().slice(0, 10)) : NaN;
      const dueEnd = Number.isFinite(dueDay) ? dueDay + DAY : w.end;
      frames.push({ index: w.index, key: w.key, label, start: w.start, end: w.end, dueEnd });
    }
  }
  const have = new Set(frames.map((f) => f.index));
  for (const l of links) {
    if (have.has(l.periodIndex)) continue;
    have.add(l.periodIndex);
    frames.push({
      index: l.periodIndex,
      key: l.periodKey ?? null,
      label: l.periodLabel || `Period ${l.periodIndex + 1}`,
      start: NaN,
      end: NaN,
      dueEnd: null,
    });
  }
  return frames.sort((a, b) => a.index - b.index);
}

function inFrame(entry: CorrelationEntry, f: PeriodFrame): boolean {
  // A frame rebuilt from a link (no window bounds) only matches by key.
  if (!Number.isFinite(f.start)) {
    const pk = isObj(entry.value) ? entry.value.periodKey : undefined;
    return f.key != null && typeof pk === "string" && (pk === f.key || pk.startsWith(`${f.key}::`));
  }
  return entryInWindow(entry, { key: f.key, start: f.start, end: f.end });
}

// ─── the report ──────────────────────────────────────────────────────

export function buildCorrelation(args: BuildCorrelationArgs): CorrelationGoal[] {
  const nowMs = args.now.getTime();
  const starred = new Set(args.evidenceIds);
  const byGoal = <T extends { goalId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.goalId);
      if (list) list.push(r);
      else m.set(r.goalId, [r]);
    }
    return m;
  };
  const liveLinks = args.links.filter((l) => LIVE.has(l.status));
  const linksByGoal = byGoal(liveLinks);
  const inputsByGoal = byGoal(args.inputs);
  const managerByGoal = byGoal(args.managerVerdicts);
  const aiByGoal = byGoal(args.aiVerdicts);

  const out: CorrelationGoal[] = [];
  for (const goal of args.goals) {
    const links = linksByGoal.get(goal.goalId) ?? [];
    if (links.length === 0) continue;
    const published = links.some((l) => l.status === "linked");
    const entries = inputsByGoal.get(goal.goalId) ?? [];
    const manager = managerByGoal.get(goal.goalId) ?? [];
    const ai = aiByGoal.get(goal.goalId) ?? [];
    const files = args.evidenceFileCounts[goal.goalId];

    const periods: CorrelationPeriod[] = framesFor(goal.spec, links, nowMs).map((f) => {
      const link = pickLink(links.filter((l) => l.periodIndex === f.index));
      const mine = entries.filter((e) => inFrame(e, f));

      let reading: CorrelationPeriod["reading"] = null;
      let readingAt = -Infinity;
      for (const e of mine) {
        const at = toMs(e.createdAt) ?? toMs(e.ts);
        if (at == null || at < readingAt) continue;
        readingAt = at;
        reading = { at: new Date(at).toISOString(), source: e.source || "manual" };
      }

      const prs = link?.state?.linkedPrs ?? [];
      const linkedPrs: CorrelationPr[] = prs.map((p) => ({
        number: p.number,
        url: p.url,
        title: p.title,
        state: p.state,
        mergedAt: iso(toMs(p.mergedAt)),
      }));
      const evidenceText = mine.some(hasEvidenceText);
      const fileCount = filesFor(files, f.key);
      const prEvidence = prs.some((p) => p.state === "merged" || starred.has(`mr-gh-${p.prId}`));
      const hasEvidence = evidenceText || fileCount > 0 || prEvidence;

      const issue = link ? issueOf(link) : null;
      const flags: CorrelationFlag[] = [];
      if (
        issue?.state === "closed" &&
        issue.stateReason !== "not_planned" &&
        !hasEvidence
      ) {
        flags.push("closed_no_evidence");
      }
      if (!link && published && (mine.length > 0 || evidenceText || fileCount > 0)) {
        flags.push("evidence_no_issue");
      }
      if (issue?.state === "open" && f.dueEnd != null && nowMs >= f.dueEnd) {
        flags.push("open_past_deadline");
      }
      if (link?.stale) flags.push("stale_period");
      if (issue?.state === "missing") flags.push("issue_missing");

      return {
        periodIndex: f.index,
        label: f.label,
        deadline: f.dueEnd == null ? null : iso(f.dueEnd - DAY),
        issue,
        linkedPrs,
        reading,
        grade: gradeFor(f.key, manager, ai),
        flags,
      };
    });

    out.push({ goalId: goal.goalId, title: goal.title, code: goal.code, periods });
  }
  return out;
}
