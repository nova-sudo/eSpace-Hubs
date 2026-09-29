export interface CycleWindow {
  start: number;
  end: number;
  key: string;
  label: string;
}
export declare function enumerateWindows(
  cadence: string,
  year: number,
  cycleStart: number,
  cycleEnd: number,
): CycleWindow[];
export declare function currentPeriodKey(
  cadence: string | null | undefined,
  now: number,
  cycleStart?: number,
  cycleEnd?: number,
): string | null;
export declare function cadenceConsistency(cycle: unknown):
  | { satisfied: number; missed: number; due: number; ratio: number }
  | null;
export declare function composedCycleBounds(spec: unknown): {
  cycleStart?: number;
  cycleEnd?: number;
  trackingStart?: number;
};
export declare function specTrackingStart(
  spec: unknown,
  cycleStart?: number | null,
  opts?: { hireDate?: unknown },
): number | null;
export declare function windowKeyAliases(
  cadence: string,
  w: { start: number; end: number; key: string },
  cycleKeys?: Set<string> | null,
): string[];
export declare function toIsoDay(value: unknown): string | null;
export declare function deriveCycleEndIso(
  cycleStartIso: string,
  cadence: string,
  periodCount: number,
): string | null;
export declare function buildCycleWindows(args: {
  entries: Array<{ ts?: number }>;
  cadence: string | null | undefined;
  now: number;
  cycleStart?: number;
  cycleEnd?: number;
  lockedKeys?: Set<string>;
  trackingStart?: number | null;
}): any;
