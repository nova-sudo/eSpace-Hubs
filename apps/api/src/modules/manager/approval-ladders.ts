/**
 * Approval ladders — the one place the approve-with-edits rules live.
 *
 * A pending spec carries two achievement ladders: `tiers` (whole cycle) and
 * `cadenceTiers` (one window). The approval queue shows both, and an approver
 * may adjust either before approving. Both the manager and the admin decision
 * handlers call these helpers; neither duplicates the rules.
 */
import { validateSpec } from "@espace-devhub/shared/goal-specs";

const ROWS = ["notAchieved", "achieved", "overAchieved", "roleModel"] as const;
type Row = (typeof ROWS)[number];
type Ladder = Record<Row, string | null>;

export interface ApprovalLadders {
  tiers: Record<string, string> | null;
  cadenceTiers: Record<string, string> | null;
  tiersSource: "ai" | "user";
}

export interface AppliedLadders {
  /** Mongo dotted paths to merge into the approve update's `$set`. */
  set: Record<string, unknown>;
  changed: { tiers: boolean; cadenceTiers: boolean };
  errors: string[];
}

type LadderKey = "tiers" | "cadenceTiers";
const LADDER_KEYS: LadderKey[] = ["tiers", "cadenceTiers"];

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Text rows only — what the queue renders. */
function projectLadder(v: unknown): Record<string, string> | null {
  if (!isObject(v)) return null;
  return Object.fromEntries(
    Object.entries(v).filter(([, row]) => typeof row === "string"),
  ) as Record<string, string>;
}

export function projectApprovalLadders(
  spec: Record<string, unknown>,
): ApprovalLadders {
  return {
    tiers: projectLadder(spec.tiers),
    cadenceTiers: projectLadder(spec.cadenceTiers),
    tiersSource: spec.tiersLocked === true ? "user" : "ai",
  };
}

function rowText(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Four rows, trimmed, blanks as null — or null when every row is blank. */
function normalizeLadder(v: unknown): Ladder | null {
  if (!isObject(v)) return null;
  const out = Object.fromEntries(ROWS.map((k) => [k, rowText(v[k])])) as Ladder;
  return ROWS.some((k) => out[k] !== null) ? out : null;
}

function sameLadder(a: Ladder | null, b: Ladder | null): boolean {
  if (a === null || b === null) return a === b;
  return ROWS.every((k) => a[k] === b[k]);
}

/**
 * Turn the approver's (optional) ladder edits into an update. A ladder that
 * is absent, null, or has all four rows blank counts as not provided; one
 * resent unchanged is not a change. Any change also locks the tiers so a
 * later re-analysis can't overwrite what the approver signed off on.
 */
export function applyApprovedLadders(
  spec: Record<string, unknown>,
  body: { tiers?: unknown; cadenceTiers?: unknown },
): AppliedLadders {
  const none: AppliedLadders = {
    set: {},
    changed: { tiers: false, cadenceTiers: false },
    errors: [],
  };

  const provided: Partial<Record<LadderKey, unknown>> = {};
  const errors: string[] = [];
  for (const key of LADDER_KEYS) {
    const raw = body[key];
    if (raw === undefined || raw === null) continue;
    const shapeOk =
      isObject(raw) &&
      ROWS.every((k) => raw[k] == null || typeof raw[k] === "string");
    if (!shapeOk) {
      errors.push(`${key}: must be an object of four text rows`);
      continue;
    }
    if (normalizeLadder(raw) === null) continue; // all blank → not provided
    provided[key] = raw;
  }
  if (errors.length > 0) return { ...none, errors };
  if (Object.keys(provided).length === 0) return none;

  const result = validateSpec({ ...spec, ...provided, tiersLocked: true });
  if (!result.ok) return { ...none, errors: result.errors };
  const validated = result.spec as unknown as Record<string, unknown>;

  const set: Record<string, unknown> = {};
  const changed = { tiers: false, cadenceTiers: false };
  for (const key of LADDER_KEYS) {
    if (!(key in provided)) continue;
    const next = normalizeLadder(validated[key]);
    if (sameLadder(next, normalizeLadder(spec[key]))) continue;
    set[`spec.${key}`] = next;
    changed[key] = true;
  }
  if (changed.tiers || changed.cadenceTiers) set["spec.tiersLocked"] = true;
  return { set, changed, errors: [] };
}
