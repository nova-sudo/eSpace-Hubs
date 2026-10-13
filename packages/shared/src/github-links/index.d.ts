/**
 * Type barrel for @espace-devhub/shared/github-links.
 */

export const MARKER_VERSION: "v1";
export const ESPACE_LABEL: "espace";
export const ESPACE_LABEL_COLOR: string;
export const MARKER_RE: RegExp;
export const COMMENT_KINDS: readonly ["manager_note", "tier_verdict"];
export type CommentKind = (typeof COMMENT_KINDS)[number];

export interface MarkerFields {
  orgId: string;
  userId: string;
  goalId: string;
  periodIndex: number;
  /** null (rendered as `once`) for a single-window plan. */
  periodKey: string | null;
}

export function buildMarker(fields: MarkerFields): string;
export function parseMarker(body: unknown): MarkerFields | null;
export function espaceLabel(goalCode: string | null | undefined, goalId?: string): string;

export function buildCommentMarker(kind: CommentKind, sourceId: string): string;
export function parseCommentMarker(
  body: unknown,
): { kind: CommentKind; sourceId: string } | null;

export interface IssueDeliverable {
  label: string;
  format?: string;
  criteria?: string;
}

export interface IssuePeriod {
  label?: string | null;
  dueAt?: string | null;
  prompt?: string | null;
  detail?: {
    focus?: string;
    activities?: string[];
    deliverables?: Array<IssueDeliverable | string>;
  } | null;
}

export function buildIssueTitle(args: {
  goalCode?: string | null;
  goalTitle?: string | null;
  periodLabel?: string | null;
}): string;

export function buildIssueBody(args: {
  period: IssuePeriod;
  goalTitle?: string | null;
  hubUrl?: string | null;
  marker: MarkerFields;
}): string;

export function taskListProgress(body: unknown): { done: number; total: number };

export function extractClosingRefs(
  text: unknown,
  opts?: { repo?: string | null },
): Array<{ repo: string; number: number }>;
