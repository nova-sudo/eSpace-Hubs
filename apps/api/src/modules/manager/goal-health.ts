/**
 * Manager goal-health — pure derivation of a report's per-goal status.
 *
 * A deliberately COARSE, honest read for the manager's board: it reports
 * facts the server can compute from stored data — readiness, auto-vs-
 * manual, whether there's any data, delegation, and the latest AI tier
 * verdict — WITHOUT replicating the dev hub's live cadence-window pace
 * engine (compliance.js / cadence-windows.js in apps/web). That engine
 * needs client-local window/lock state; porting it server-side is a
 * follow-up (see docs/manager-hub-plan.md). The AI tier verdict — the
 * signal a manager most cares about — is the SAME row the dev's own hub
 * reads (goal_tier_verdicts), so there's no divergence on grade.
 *
 * The readiness enum values mirror GOAL_READINESS in
 * apps/web/src/features/goal-widgets/readiness.js so the web client's
 * `readinessLabel` maps them directly. Keep the two in sync.
 *
 * Pure — no IO, no Mongo. The controller does the reads and feeds the
 * parts in.
 */

import { SPEC_KIND_META, SPEC_VARIANTS } from "@espace-devhub/shared/goal-specs";
import type { ContextAnswer } from "../../db/types.js";

export type Readiness =
  | "unclassified"
  | "untrackable"
  | "delegated"
  | "needs-context"
  | "ready";

export type GoalStatus =
  | "unclassified"
  | "untrackable"
  | "delegated"
  | "needs_setup"
  | "auto"
  | "no_data"
  | "tracking";

export type SpecVariant = "auto" | "manual" | "hybrid";

type Spec = Record<string, unknown>;

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Best-effort context completeness: every required context question has a
 * non-empty answer. Approximates the web's `isContextComplete`; when the
 * question list is absent we fall back to "any answer recorded".
 */
export function contextComplete(
  spec: Spec | null,
  answers: Record<string, ContextAnswer>,
): boolean {
  const ctx = asObj(spec?.context ?? null);
  if (!ctx || ctx.required !== true) return true;
  const questions = Array.isArray(ctx.questions) ? ctx.questions : [];
  if (questions.length === 0) return Object.keys(answers ?? {}).length > 0;
  return questions.every((q) => {
    const id = asObj(q)?.id;
    if (typeof id !== "string") return true; // unparseable → don't block
    const a = answers?.[id];
    if (a == null) return false;
    if (Array.isArray(a)) return a.length > 0;
    if (typeof a === "string") return a.trim().length > 0;
    return true;
  });
}

/**
 * The single readiness gate — mirrors `goalReadiness` in
 * apps/web/src/features/goal-widgets/readiness.js.
 */
export function goalReadiness(spec: Spec | null, ctxComplete: boolean): Readiness {
  if (!spec) return "unclassified";
  if (spec.untrackable === true) return "untrackable";
  if (asObj(spec.delegated)?.delegated === true) return "delegated";
  if (asObj(spec.context)?.required === true && !ctxComplete) {
    return "needs-context";
  }
  return "ready";
}

export function specVariant(spec: Spec | null): SpecVariant | null {
  if (!spec || typeof spec.widget !== "string") return null;
  const meta = (SPEC_KIND_META as Record<string, { variant?: string }>)[
    spec.widget
  ];
  return (meta?.variant as SpecVariant) ?? "manual";
}

export function specKindLabel(spec: Spec | null): string | null {
  if (!spec || typeof spec.widget !== "string") return null;
  const meta = (SPEC_KIND_META as Record<string, { label?: string }>)[
    spec.widget
  ];
  return meta?.label ?? spec.widget;
}

/** The delegated judge ("manager" | "senior" | "peer") or null. */
export function delegatedJudge(spec: Spec | null): string | null {
  const d = asObj(spec?.delegated ?? null);
  if (d?.delegated !== true) return null;
  return typeof d.judge === "string" ? d.judge : null;
}

/**
 * Collapse readiness + variant + data-presence into one board status.
 * AUTO goals are computed (no fill obligation); a ready manual goal with
 * no entries is "no data", otherwise "tracking" (the tier verdict, not
 * this status, carries achievement).
 */
export function deriveStatus(
  readiness: Readiness,
  variant: SpecVariant | null,
  hasEntries: boolean,
): GoalStatus {
  switch (readiness) {
    case "unclassified":
      return "unclassified";
    case "untrackable":
      return "untrackable";
    case "delegated":
      return "delegated";
    case "needs-context":
      return "needs_setup";
    default:
      if (variant === SPEC_VARIANTS.AUTO) return "auto";
      return hasEntries ? "tracking" : "no_data";
  }
}
