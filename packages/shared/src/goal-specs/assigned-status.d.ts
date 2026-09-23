export type AssignedPeriodStatus = "upcoming" | "open" | "on_time" | "late" | "missing";

export interface AssignedWindow {
  index: number;
  key: string | null;
  label: string;
  start: number;
  end: number;
}

export interface AssignedPeriodCell {
  key: string | null;
  index: number;
  label: string;
  start: number;
  end: number;
  deadline: number;
  status: AssignedPeriodStatus;
  submittedAt: number | null;
  lastEditedAt: number | null;
  filledFields: number;
  totalFields: number;
  approx: boolean;
}

export interface AssignedStatusSummary {
  onTime: number;
  late: number;
  missing: number;
  open: number;
  upcoming: number;
  due: number;
  completionRate: number | null;
  onTimeRate: number | null;
}

export declare function assignedWindows(spec: unknown, now?: number): AssignedWindow[];
export declare function periodStatuses(args: {
  spec: unknown;
  entries: Array<{ ts?: unknown; createdAt?: unknown; value?: unknown }>;
  now?: number;
  graceMs?: number;
  timeZone?: string;
}): AssignedPeriodCell[];
export declare function localMidnight(isoDay: string, timeZone?: string): number | null;
export declare function summarizeStatuses(cells: AssignedPeriodCell[]): AssignedStatusSummary;
