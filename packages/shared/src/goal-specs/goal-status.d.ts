export type GoalStatusKey =
  | "behind"
  | "not-logged"
  | "needs-setup"
  | "unclassified"
  | "on-pace"
  | "auto"
  | "exceeding";

export interface GoalStatusMeta {
  label: string;
  tone: "peach" | "lemon" | "neutral" | "mint" | "lav" | "sky";
  description: string;
}

export declare const GOAL_STATUS: Readonly<{
  BEHIND: "behind";
  NOT_LOGGED: "not-logged";
  NEEDS_SETUP: "needs-setup";
  UNCLASSIFIED: "unclassified";
  NO_TRACKER: "unclassified";
  ON_PACE: "on-pace";
  AUTO: "auto";
  EXCEEDING: "exceeding";
}>;
export declare const STATUS_META: Readonly<Record<GoalStatusKey, GoalStatusMeta>>;
export declare const SEVERITY: readonly GoalStatusKey[];

export interface LoggedSoFar {
  done: number;
  due: number;
  owed: number;
}

export interface GoalStatusResult extends GoalStatusMeta {
  status: GoalStatusKey;
  reason: string | null;
  quiet: number;
  logged: LoggedSoFar | null;
}

export declare function isMeasurable(status: string): boolean;
export declare function statusMeta(status: string): GoalStatusMeta;
export declare function periodWords(cadence: string | null | undefined): [string, string];
export declare function loggedSoFar(cycle: unknown): LoggedSoFar | null;
export declare function quietWindows(cycle: unknown): number;
export declare function goalStatus(facts: {
  hasTracker: boolean;
  ready?: boolean;
  auto?: boolean;
  cycle?: unknown;
  hasData?: boolean;
  tier?: string | null;
  cadence?: string | null;
}): GoalStatusResult;
export declare function worstStatus(statuses: string[]): GoalStatusKey | null;
export declare function objectiveStatus(statuses: string[]): GoalStatusKey | null;
export declare function countStatuses(
  statuses: string[],
): Array<GoalStatusMeta & { status: GoalStatusKey; count: number }>;
