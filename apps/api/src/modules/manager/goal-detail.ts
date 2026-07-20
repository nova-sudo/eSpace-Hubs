/**
 * Manager goal-detail — pure projection of ONE report's goal into a
 * read-only review payload for the grading drawer.
 *
 * This is the server half of "show me a read-only GoalWidget while I
 * grade". A manager can't render the dev hub's real widget (it reads the
 * session user's client stores), so we project the same underlying data
 * into a display-ready shape and render a purpose-built read-only panel.
 *
 * Emphasis, matching the grading flow:
 *   - the goal's definition (kind, cadence, what it measures),
 *   - the achievement-tier criteria — what each tier MEANS for THIS goal,
 *   - the EVIDENCE the engineer logged (composed-field evidence text, link
 *     fields, entry notes),
 *   - the AI's tier verdict (tier + confidence + full reasoning).
 *
 * No live pace engine — same honest, stored-data read as goal-health.ts.
 * Pure: the controller does the Mongo reads and feeds the parts in.
 */

import type {
  GoalInputEntry,
  GoalTier,
  GoalTierVerdictBody,
} from "../../db/types.js";
import {
  delegatedJudge,
  specKindLabel,
  specVariant,
  type SpecVariant,
} from "./goal-health.js";

type Spec = Record<string, unknown>;

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Render any stored input value as a short display string, or null when empty. */
function stringifyValue(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string") return v.trim().length > 0 ? v.trim() : null;
  if (Array.isArray(v)) {
    const parts = v.map((x) => stringifyValue(x)).filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function isLinkish(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

// ─── spec projection (the read-only "what is this goal") ─────────────

interface FieldProjection {
  id: string;
  kind: string;
  label: string;
  unit: string | null;
  optional: boolean;
  options: string[] | null;
  help: string | null;
}

interface TierProjection {
  /** Achievement-tier key, ordered low → high. */
  key: GoalTier;
  criterion: string | null;
}

export interface SpecProjection {
  widget: string | null;
  kindLabel: string | null;
  variant: SpecVariant | null;
  reasoning: string;
  cadence: string | null;
  prompt: string | null;
  unit: string | null;
  target: { op: string; value: number; period: string | null } | null;
  delegated: { judge: string | null; note: string | null } | null;
  untrackable: { reason: string } | null;
  source: { provider: string; metric: string; window: string } | null;
  fields: FieldProjection[] | null;
  tiers: TierProjection[] | null;
}

const TIER_SPEC_KEYS: readonly { key: GoalTier; specKey: string }[] = [
  { key: "not_achieved", specKey: "notAchieved" },
  { key: "achieved", specKey: "achieved" },
  { key: "over_achieved", specKey: "overAchieved" },
  { key: "role_model", specKey: "roleModel" },
];

function projectTarget(
  t: unknown,
): { op: string; value: number; period: string | null } | null {
  const o = asObj(t);
  if (!o) return null;
  if (typeof o.op !== "string" || typeof o.value !== "number") return null;
  return { op: o.op, value: o.value, period: str(o.period) };
}

function projectSpec(spec: Spec | null): SpecProjection | null {
  if (!spec) return null;
  const manual = asObj(spec.manual);
  const composed = asObj(spec.composed);
  const source = asObj(spec.source);
  const delegated = asObj(spec.delegated);
  const untrackable = asObj(spec.untrackable);
  const tiersObj = asObj(spec.tiers);

  const rawFields = Array.isArray(spec.fields) ? spec.fields : null;
  const fields: FieldProjection[] | null = rawFields
    ? rawFields
        .map((f) => asObj(f))
        .filter((f): f is Record<string, unknown> => f != null)
        .map((f) => ({
          id: str(f.id) ?? "",
          kind: str(f.kind) ?? "text",
          label: str(f.label) ?? "Field",
          unit: str(f.unit),
          optional: f.optional === true,
          options: Array.isArray(f.options)
            ? (f.options.filter((o) => typeof o === "string") as string[])
            : null,
          help: str(f.help),
        }))
    : null;

  const tiers: TierProjection[] | null = tiersObj
    ? TIER_SPEC_KEYS.map(({ key, specKey }) => ({
        key,
        criterion: str(tiersObj[specKey]),
      }))
    : null;
  // Collapse to null when the block carries no usable prose (all four blank).
  const tiersOut =
    tiers && tiers.some((t) => t.criterion != null) ? tiers : null;

  return {
    widget: str(spec.widget),
    kindLabel: specKindLabel(spec),
    variant: specVariant(spec),
    reasoning: str(spec.reasoning) ?? "",
    cadence: str(manual?.cadence) ?? str(composed?.cadence),
    prompt: str(manual?.prompt) ?? str(composed?.prompt),
    unit: str(manual?.unit),
    target: projectTarget(manual?.target ?? source?.target),
    delegated: delegated
      ? { judge: delegatedJudge(spec), note: str(delegated.note) }
      : null,
    untrackable: untrackable?.reason
      ? { reason: str(untrackable.reason) ?? "" }
      : null,
    source: source
      ? {
          provider: str(source.provider) ?? "",
          metric: str(source.metric) ?? "",
          window: str(source.window) ?? "",
        }
      : null,
    fields: fields && fields.length > 0 ? fields : null,
    tiers: tiersOut,
  };
}

// ─── entries + evidence (the read-only "what did they log") ──────────

interface ReviewCell {
  label: string;
  kind: string;
  value: string | null;
  unit: string | null;
  evidence: string | null;
  isLink: boolean;
}

export interface ReviewEntry {
  ts: string;
  source: "manual" | "auto";
  periodKey: string | null;
  note: string | null;
  cells: ReviewCell[];
}

export interface EvidencePoint {
  ts: string;
  /** Field label the evidence came from, or null for an entry-level note. */
  from: string | null;
  text: string;
  kind: "text" | "link";
}

/** Detect the COMPOSED `{ periodKey, values, evidence }` entry shape. */
function isComposedValue(v: unknown): v is {
  periodKey?: unknown;
  values?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
} {
  const o = asObj(v);
  return o != null && ("values" in o || "evidence" in o || "periodKey" in o);
}

const MAX_ENTRIES = 12;
const MAX_EVIDENCE = 24;

function normalizeEntries(
  inputs: GoalInputEntry[],
  fields: FieldProjection[] | null,
): { entries: ReviewEntry[]; evidence: EvidencePoint[] } {
  const fieldById = new Map((fields ?? []).map((f) => [f.id, f]));
  const entries: ReviewEntry[] = [];
  const evidence: EvidencePoint[] = [];

  for (const e of inputs.slice(0, MAX_ENTRIES)) {
    const ts = e.ts instanceof Date ? e.ts.toISOString() : new Date().toISOString();
    const note = str(e.note);
    const cells: ReviewCell[] = [];
    let periodKey: string | null = null;

    if (isComposedValue(e.value)) {
      const vObj = e.value as {
        periodKey?: unknown;
        values?: Record<string, unknown>;
        evidence?: Record<string, unknown>;
      };
      periodKey = str(vObj.periodKey);
      const values = asObj(vObj.values) ?? {};
      const ev = asObj(vObj.evidence) ?? {};
      // Walk in declared field order when we have the schema, else value keys.
      const ids =
        fields && fields.length > 0
          ? fields.map((f) => f.id)
          : Object.keys(values);
      for (const id of ids) {
        const f = fieldById.get(id) ?? null;
        const rawVal = values[id];
        const valStr = stringifyValue(rawVal);
        const evText = str(ev[id]);
        if (valStr == null && evText == null) continue;
        const label = f?.label ?? id;
        const link = f?.kind === "link" || (valStr != null && isLinkish(valStr));
        cells.push({
          label,
          kind: f?.kind ?? "text",
          value: valStr,
          unit: f?.unit ?? null,
          evidence: evText,
          isLink: link,
        });
        if (evText) {
          evidence.push({
            ts,
            from: label,
            text: evText,
            kind: isLinkish(evText) ? "link" : "text",
          });
        }
        if (link && valStr) {
          evidence.push({ ts, from: label, text: valStr, kind: "link" });
        }
      }
    } else {
      const plain = asObj(e.value);
      if (plain) {
        // Milestone/object map — surface each present key.
        for (const [k, raw] of Object.entries(plain)) {
          const valStr = stringifyValue(raw);
          if (valStr == null) continue;
          cells.push({
            label: k,
            kind: "value",
            value: valStr,
            unit: null,
            evidence: null,
            isLink: isLinkish(valStr),
          });
        }
      } else {
        const valStr = stringifyValue(e.value);
        if (valStr != null) {
          cells.push({
            label: "Value",
            kind: "value",
            value: valStr,
            unit: null,
            evidence: null,
            isLink: isLinkish(valStr),
          });
        }
      }
    }

    if (note) {
      evidence.push({
        ts,
        from: null,
        text: note,
        kind: isLinkish(note) ? "link" : "text",
      });
    }

    entries.push({ ts, source: e.source, periodKey, note, cells });
  }

  return { entries, evidence: evidence.slice(0, MAX_EVIDENCE) };
}

// ─── the assembled detail payload ────────────────────────────────────

export interface GoalDetail {
  goal: { id: string; code: string; title: string; category: string };
  l1: { id: string; code: string; title: string; category: string } | null;
  spec: SpecProjection | null;
  ai: {
    tier: GoalTier;
    reasoning: string;
    confidence: "high" | "medium" | "low";
    gradedAt: string;
  } | null;
  manager: {
    tier: GoalTier;
    note: string;
    gradedByName: string;
    gradedAt: string;
  } | null;
  entries: ReviewEntry[];
  evidence: EvidencePoint[];
  entryCount: number;
}

export function buildGoalDetail(args: {
  l2: { id: string; code: string; title: string; category: string };
  l1: { id: string; code: string; title: string; category: string } | null;
  spec: Spec | null;
  aiVerdict: { verdict: GoalTierVerdictBody; gradedAt: Date } | null;
  managerVerdict: {
    tier: GoalTier;
    note: string;
    gradedByName: string;
    gradedAt: Date;
  } | null;
  inputs: GoalInputEntry[];
  totalEntryCount: number;
}): GoalDetail {
  const spec = projectSpec(args.spec);
  const { entries, evidence } = normalizeEntries(args.inputs, spec?.fields ?? null);

  return {
    goal: args.l2,
    l1: args.l1,
    spec,
    ai: args.aiVerdict
      ? {
          tier: args.aiVerdict.verdict.tier,
          reasoning: args.aiVerdict.verdict.reasoning,
          confidence: args.aiVerdict.verdict.confidence,
          gradedAt: args.aiVerdict.gradedAt.toISOString(),
        }
      : null,
    manager: args.managerVerdict
      ? {
          tier: args.managerVerdict.tier,
          note: args.managerVerdict.note,
          gradedByName: args.managerVerdict.gradedByName,
          gradedAt: args.managerVerdict.gradedAt.toISOString(),
        }
      : null,
    entries,
    evidence,
    entryCount: args.totalEntryCount,
  };
}
