/**
 * GoalSpec validator. Pure (no IO, no side-effects), so it runs in both
 * the API and tests with no fixtures.
 *
 * ⚠ DUPLICATED from apps/web/src/features/goal-specs/schema.js for M3.2.
 *    M4 deletes the duplicate by hoisting both copies into
 *    packages/shared/. Mirror changes on both sides until then.
 *
 * Permissive on optional fields (target, unit, filter), strict on
 * everything a widget needs to render.
 */

import {
  ALL_SOURCE_METRICS,
  ALL_SOURCE_PROVIDERS,
  ALL_SPEC_KINDS,
  ALL_SPEC_VARIANTS,
  CONTEXT_QUESTION_KINDS,
  DELEGATED_JUDGES,
  MANUAL_CADENCES,
  normalizeCadence,
  SOURCE_WINDOWS,
  SPEC_KIND_META,
  SPEC_SCHEMA_VERSION,
  SPEC_VARIANTS,
  TARGET_OPS,
  type SpecContext,
  type SpecContextQuestion,
  type SpecDelegated,
  type SpecManual,
  type SpecSource,
  type SpecTarget,
  type ValidatedSpec,
} from "./spec-types.js";

export type ValidationResult =
  | { ok: true; spec: ValidatedSpec }
  | { ok: false; errors: string[] };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function validateTarget(
  target: unknown,
  path: string,
  errors: string[],
): SpecTarget | null {
  if (target == null) return null;
  if (!isObject(target)) {
    errors.push(`${path}: target must be an object`);
    return null;
  }
  const op = target.op as unknown;
  if (!TARGET_OPS.includes(op as never)) {
    errors.push(`${path}.op: must be one of ${TARGET_OPS.join(", ")}`);
    return null;
  }
  if (typeof target.value !== "number" || Number.isNaN(target.value)) {
    errors.push(`${path}.value: must be a number`);
    return null;
  }
  const out: SpecTarget = { op: op as SpecTarget["op"], value: target.value };
  if (typeof target.period === "string" && target.period.trim().length > 0) {
    out.period = target.period.trim();
  }
  return out;
}

function validateSource(
  source: unknown,
  errors: string[],
): SpecSource | null {
  if (!isObject(source)) {
    errors.push("source: must be an object when kind is auto/hybrid");
    return null;
  }
  const provider = source.provider as unknown;
  if (!ALL_SOURCE_PROVIDERS.includes(provider as never)) {
    errors.push(
      `source.provider: must be one of ${ALL_SOURCE_PROVIDERS.join(", ")}`,
    );
    return null;
  }
  const metric = source.metric as unknown;
  if (!ALL_SOURCE_METRICS.includes(metric as never)) {
    errors.push(
      `source.metric: must be one of ${ALL_SOURCE_METRICS.join(", ")}`,
    );
    return null;
  }
  const window = source.window as unknown;
  if (!SOURCE_WINDOWS.includes(window as never)) {
    errors.push(`source.window: must be one of ${SOURCE_WINDOWS.join(", ")}`);
    return null;
  }
  const out: SpecSource = {
    provider: provider as SpecSource["provider"],
    metric: metric as SpecSource["metric"],
    window: window as SpecSource["window"],
  };
  if (isObject(source.filter)) {
    const filter: NonNullable<SpecSource["filter"]> = {};
    if (isNonEmptyString(source.filter.label))
      filter.label = source.filter.label.trim();
    if (isNonEmptyString(source.filter.branch))
      filter.branch = source.filter.branch.trim();
    if (isNonEmptyString(source.filter.ticketType))
      filter.ticketType = source.filter.ticketType.trim();
    if (Object.keys(filter).length > 0) out.filter = filter;
  }
  const target = validateTarget(source.target, "source", errors);
  if (target) out.target = target;
  return out;
}

function validateContext(
  context: unknown,
  errors: string[],
): SpecContext | null {
  if (context == null) return null;
  if (!isObject(context)) {
    errors.push("context: must be an object when present");
    return null;
  }
  const questionsRaw = Array.isArray(context.questions)
    ? context.questions
    : [];
  const out: SpecContextQuestion[] = [];
  questionsRaw.forEach((q: unknown, i: number) => {
    if (!isObject(q)) {
      errors.push(`context.questions[${i}]: must be an object`);
      return;
    }
    if (!isNonEmptyString(q.prompt)) {
      errors.push(`context.questions[${i}].prompt: required string`);
      return;
    }
    const kind = q.kind as unknown;
    if (!CONTEXT_QUESTION_KINDS.includes(kind as never)) {
      errors.push(
        `context.questions[${i}].kind: must be one of ${CONTEXT_QUESTION_KINDS.join(", ")}`,
      );
      return;
    }
    const normalised: SpecContextQuestion = {
      id: isNonEmptyString(q.id) ? q.id.trim() : `q${i + 1}`,
      prompt: q.prompt.trim(),
      kind: kind as SpecContextQuestion["kind"],
    };
    if (isNonEmptyString(q.placeholder)) {
      normalised.placeholder = q.placeholder.trim();
    }
    if (kind === "select") {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        errors.push(
          `context.questions[${i}].options: required non-empty for kind "select"`,
        );
        return;
      }
      normalised.options = (q.options as unknown[])
        .map((opt) => (typeof opt === "string" ? opt.trim() : ""))
        .filter(Boolean);
    }
    out.push(normalised);
  });
  return {
    required: Boolean(context.required),
    questions: out,
  };
}

function validateDelegated(
  delegated: unknown,
  errors: string[],
): SpecDelegated | null {
  if (delegated == null) return null;
  if (!isObject(delegated)) {
    errors.push("delegated: must be an object when present");
    return null;
  }
  const out: SpecDelegated = { delegated: Boolean(delegated.delegated) };
  if (delegated.judge != null) {
    if (!DELEGATED_JUDGES.includes(delegated.judge as never)) {
      errors.push(
        `delegated.judge: must be one of ${DELEGATED_JUDGES.join(", ")}`,
      );
    } else {
      out.judge = delegated.judge as SpecDelegated["judge"];
    }
  }
  if (isNonEmptyString(delegated.note)) {
    out.note = delegated.note.trim();
  }
  return out;
}

function validateManual(
  manual: unknown,
  errors: string[],
): SpecManual | null {
  if (!isObject(manual)) {
    errors.push("manual: must be an object when kind is manual/hybrid");
    return null;
  }
  if (!isNonEmptyString(manual.prompt)) {
    errors.push("manual.prompt: required string");
    return null;
  }
  const cadence = normalizeCadence(manual.cadence);
  if (!cadence) {
    errors.push(
      `manual.cadence: must be one of ${MANUAL_CADENCES.join(", ")}`,
    );
    return null;
  }
  const out: SpecManual = {
    prompt: manual.prompt.trim(),
    cadence,
  };
  if (isNonEmptyString(manual.unit)) out.unit = manual.unit.trim();
  if (Array.isArray(manual.items)) {
    out.items = (manual.items as unknown[])
      .map((it) => (typeof it === "string" ? it.trim() : ""))
      .filter(Boolean);
  }
  const target = validateTarget(manual.target, "manual", errors);
  if (target) out.target = target;
  return out;
}

/**
 * Validate an incoming spec (from AI, from storage, from anywhere).
 * Normalises shapes so consumers can trust the output downstream.
 */
export function validateSpec(obj: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(obj)) {
    return { ok: false, errors: ["spec: must be an object"] };
  }

  if (!isNonEmptyString(obj.goalId)) errors.push("goalId: required string");
  if (!isNonEmptyString(obj.title)) errors.push("title: required string");
  const variant = obj.kind as unknown;
  if (!ALL_SPEC_VARIANTS.includes(variant as never)) {
    errors.push(`kind: must be one of ${ALL_SPEC_VARIANTS.join(", ")}`);
  }
  const widget = obj.widget as unknown;
  if (!ALL_SPEC_KINDS.includes(widget as never)) {
    errors.push(`widget: must be one of ${ALL_SPEC_KINDS.join(", ")}`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const widgetTyped = widget as keyof typeof SPEC_KIND_META;
  const variantTyped = variant as (typeof ALL_SPEC_VARIANTS)[number];
  const widgetMeta = SPEC_KIND_META[widgetTyped];

  // Soft cross-check: the spec's variant should align with the widget's
  // declared variant, EXCEPT for hybrid where either side is allowed
  // because the widget renders both.
  if (
    widgetMeta &&
    variantTyped !== SPEC_VARIANTS.HYBRID &&
    widgetMeta.variant !== variantTyped
  ) {
    errors.push(
      `widget "${widgetTyped}" is a ${widgetMeta.variant} widget but spec kind is "${variantTyped}"`,
    );
  }

  let source: SpecSource | null = null;
  let manual: SpecManual | null = null;
  const meta = widgetMeta;
  const sourceRequired =
    (variantTyped === SPEC_VARIANTS.AUTO ||
      variantTyped === SPEC_VARIANTS.HYBRID) &&
    meta?.requiresSource !== false;
  const manualRequired =
    (variantTyped === SPEC_VARIANTS.MANUAL ||
      variantTyped === SPEC_VARIANTS.HYBRID) &&
    meta?.requiresManual !== false;

  if (sourceRequired) {
    source = validateSource(obj.source, errors);
  } else if (obj.source != null) {
    // Optional pass-through: widget doesn't need it, accept silently.
    const collected: string[] = [];
    source = validateSource(obj.source, collected);
  }
  if (manualRequired) {
    manual = validateManual(obj.manual, errors);
  } else if (obj.manual != null) {
    const collected: string[] = [];
    manual = validateManual(obj.manual, collected);
  }

  const context = validateContext(obj.context, errors);
  const delegated = validateDelegated(obj.delegated, errors);

  if (errors.length > 0) return { ok: false, errors };

  const reasoning = isNonEmptyString(obj.reasoning) ? obj.reasoning.trim() : "";
  const goalId = (obj.goalId as string).trim();
  const title = (obj.title as string).trim();
  const classifiedAt =
    typeof obj.classifiedAt === "number" && obj.classifiedAt > 0
      ? obj.classifiedAt
      : Date.now();

  const spec: ValidatedSpec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    goalId,
    kind: variantTyped,
    widget: widgetTyped,
    title,
    reasoning,
    source,
    manual,
    context,
    delegated,
    classifiedAt,
  };

  return { ok: true, spec };
}
