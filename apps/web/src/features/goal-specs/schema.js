/**
 * GoalSpec schema + hand-rolled validator.
 *
 * Kept dependency-free (no zod, no react) so it runs in both the browser and
 * the Next.js server route without pulling a schema lib into the client bundle.
 *
 * Shape:
 *
 *   {
 *     schemaVersion: 1,
 *     goalId: string,              // from goals-store
 *     kind: "auto" | "manual" | "hybrid",
 *     widget: SPEC_KINDS[...],     // picks the component to render
 *     title: string,               // denormalized goal title at classify-time
 *     reasoning: string,           // why the AI classified it this way
 *     source: { ... } | null,      // required when kind ∈ {"auto","hybrid"}
 *     manual: { ... } | null,      // required when kind ∈ {"manual","hybrid"}
 *     classifiedAt: number         // epoch ms
 *   }
 *
 * validateSpec(obj) → { ok: true, spec } | { ok: false, errors: string[] }
 *
 * The validator is intentionally permissive on optional fields (target, unit,
 * filter) and strict on everything a widget needs to render.
 */

import {
  ALL_SOURCE_PROVIDERS,
  ALL_SOURCE_METRICS,
  ALL_SPEC_KINDS,
  ALL_SPEC_VARIANTS,
  CONTEXT_QUESTION_KINDS,
  DELEGATED_JUDGES,
  MANUAL_CADENCES,
  normalizeCadence,
  SOURCE_WINDOWS,
  SPEC_KINDS,
  SPEC_KIND_META,
  SPEC_SCHEMA_VERSION,
  SPEC_VARIANTS,
  TARGET_OPS,
} from "./types";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function validateTarget(target, path, errors) {
  if (target == null) return null;
  if (!isObject(target)) {
    errors.push(`${path}: target must be an object`);
    return null;
  }
  if (!TARGET_OPS.includes(target.op)) {
    errors.push(`${path}.op: must be one of ${TARGET_OPS.join(", ")}`);
    return null;
  }
  if (typeof target.value !== "number" || Number.isNaN(target.value)) {
    errors.push(`${path}.value: must be a number`);
    return null;
  }
  const out = { op: target.op, value: target.value };
  if (typeof target.period === "string" && target.period.trim().length > 0) {
    out.period = target.period.trim();
  }
  return out;
}

function validateSource(source, errors) {
  if (!isObject(source)) {
    errors.push("source: must be an object when kind is auto/hybrid");
    return null;
  }
  if (!ALL_SOURCE_PROVIDERS.includes(source.provider)) {
    errors.push(
      `source.provider: must be one of ${ALL_SOURCE_PROVIDERS.join(", ")}`,
    );
    return null;
  }
  if (!ALL_SOURCE_METRICS.includes(source.metric)) {
    errors.push(
      `source.metric: must be one of ${ALL_SOURCE_METRICS.join(", ")}`,
    );
    return null;
  }
  if (!SOURCE_WINDOWS.includes(source.window)) {
    errors.push(
      `source.window: must be one of ${SOURCE_WINDOWS.join(", ")}`,
    );
    return null;
  }
  const out = {
    provider: source.provider,
    metric: source.metric,
    window: source.window,
  };
  if (isObject(source.filter)) {
    const filter = {};
    if (isNonEmptyString(source.filter.label)) filter.label = source.filter.label.trim();
    if (isNonEmptyString(source.filter.branch)) filter.branch = source.filter.branch.trim();
    if (isNonEmptyString(source.filter.ticketType)) filter.ticketType = source.filter.ticketType.trim();
    if (Object.keys(filter).length > 0) out.filter = filter;
  }
  const target = validateTarget(source.target, "source", errors);
  if (target) out.target = target;
  return out;
}

/**
 * User-supplied context — optional list of questions the user answers
 * before tracking becomes meaningful (e.g. "define your team's quality
 * standards"). Returns a normalized `{ required, questions }` object or
 * null if the incoming block is missing/invalid in a recoverable way.
 */
function validateContext(context, errors) {
  if (context == null) return null;
  if (!isObject(context)) {
    errors.push("context: must be an object when present");
    return null;
  }
  const questions = Array.isArray(context.questions) ? context.questions : [];
  const out = [];
  questions.forEach((q, i) => {
    if (!isObject(q)) {
      errors.push(`context.questions[${i}]: must be an object`);
      return;
    }
    if (!isNonEmptyString(q.prompt)) {
      errors.push(`context.questions[${i}].prompt: required string`);
      return;
    }
    if (!CONTEXT_QUESTION_KINDS.includes(q.kind)) {
      errors.push(
        `context.questions[${i}].kind: must be one of ${CONTEXT_QUESTION_KINDS.join(", ")}`,
      );
      return;
    }
    const normalized = {
      id: isNonEmptyString(q.id) ? q.id.trim() : `q${i + 1}`,
      prompt: q.prompt.trim(),
      kind: q.kind,
    };
    if (isNonEmptyString(q.placeholder)) normalized.placeholder = q.placeholder.trim();
    if (q.kind === "select") {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        errors.push(`context.questions[${i}].options: required non-empty for kind "select"`);
        return;
      }
      normalized.options = q.options
        .map((opt) => (typeof opt === "string" ? opt.trim() : ""))
        .filter(Boolean);
    }
    out.push(normalized);
  });
  return {
    required: Boolean(context.required),
    questions: out,
  };
}

/**
 * Delegation block — marks a goal as judged by a human (manager, senior,
 * peer) rather than self-tracked. When present and `delegated === true`,
 * the widget resolver shows a `DelegatedCard` instead of a tracker.
 */
function validateDelegated(delegated, errors) {
  if (delegated == null) return null;
  if (!isObject(delegated)) {
    errors.push("delegated: must be an object when present");
    return null;
  }
  const out = { delegated: Boolean(delegated.delegated) };
  if (delegated.judge != null) {
    if (!DELEGATED_JUDGES.includes(delegated.judge)) {
      errors.push(
        `delegated.judge: must be one of ${DELEGATED_JUDGES.join(", ")}`,
      );
    } else {
      out.judge = delegated.judge;
    }
  }
  if (isNonEmptyString(delegated.note)) out.note = delegated.note.trim();
  return out;
}

function validateManual(manual, errors) {
  if (!isObject(manual)) {
    errors.push("manual: must be an object when kind is manual/hybrid");
    return null;
  }
  if (!isNonEmptyString(manual.prompt)) {
    errors.push("manual.prompt: required string");
    return null;
  }
  // Coerce synonyms (e.g. "quarterly", "per incident", "ongoing") to a
  // canonical cadence before enum-checking. Only actual gibberish triggers
  // a validation failure now.
  const cadence = normalizeCadence(manual.cadence);
  if (!cadence) {
    errors.push(
      `manual.cadence: must be one of ${MANUAL_CADENCES.join(", ")}`,
    );
    return null;
  }
  const out = {
    prompt: manual.prompt.trim(),
    cadence,
  };
  if (isNonEmptyString(manual.unit)) out.unit = manual.unit.trim();
  if (Array.isArray(manual.items)) {
    // Optional pre-seeded items (used by MILESTONE widget). Coerce to strings.
    out.items = manual.items
      .map((it) => (typeof it === "string" ? it.trim() : ""))
      .filter(Boolean);
  }
  const target = validateTarget(manual.target, "manual", errors);
  if (target) out.target = target;
  return out;
}

/**
 * Validate an incoming spec (from AI, from storage, from anywhere).
 * Normalizes the output so consumers can trust shapes downstream.
 *
 * @param {unknown} obj
 * @returns {{ok: true, spec: object} | {ok: false, errors: string[]}}
 */
export function validateSpec(obj) {
  const errors = [];
  if (!isObject(obj)) {
    return { ok: false, errors: ["spec: must be an object"] };
  }

  if (!isNonEmptyString(obj.goalId)) errors.push("goalId: required string");
  if (!isNonEmptyString(obj.title)) errors.push("title: required string");
  if (!ALL_SPEC_VARIANTS.includes(obj.kind)) {
    errors.push(`kind: must be one of ${ALL_SPEC_VARIANTS.join(", ")}`);
  }
  if (!ALL_SPEC_KINDS.includes(obj.widget)) {
    errors.push(
      `widget: must be one of ${ALL_SPEC_KINDS.join(", ")}`,
    );
  }

  // Early out — without a kind or widget we can't meaningfully validate.
  if (errors.length > 0) return { ok: false, errors };

  // Cross-field: widget variant should match spec kind (soft-validation).
  // We warn rather than reject so the AI can classify a goal as "hybrid"
  // but pick an AUTO widget (e.g. MERGED_COUNT) — the widget itself will
  // render the manual half if present.
  const widgetMeta = SPEC_KIND_META[obj.widget];
  if (
    widgetMeta &&
    obj.kind !== SPEC_VARIANTS.HYBRID &&
    widgetMeta.variant !== obj.kind
  ) {
    errors.push(
      `widget "${obj.widget}" is a ${widgetMeta.variant} widget but spec kind is "${obj.kind}"`,
    );
  }

  // Conditional fields. Widgets can opt out of the default requirement via
  // `SPEC_KIND_META[widget].requiresSource / requiresManual = false` when
  // they have their own data pipeline (e.g. CODE_RUBRIC). Defaults:
  //   - AUTO / HYBRID → source required
  //   - MANUAL / HYBRID → manual required
  let source = null;
  let manual = null;
  const meta = SPEC_KIND_META[obj.widget] || {};
  const sourceRequired =
    (obj.kind === SPEC_VARIANTS.AUTO || obj.kind === SPEC_VARIANTS.HYBRID) &&
    meta.requiresSource !== false;
  const manualRequired =
    (obj.kind === SPEC_VARIANTS.MANUAL || obj.kind === SPEC_VARIANTS.HYBRID) &&
    meta.requiresManual !== false;

  if (sourceRequired) {
    source = validateSource(obj.source, errors);
  } else if (obj.source != null) {
    // Optional pass-through: widget doesn't need it, but accept if the AI
    // emitted one anyway. Skip errors silently.
    const collected = [];
    source = validateSource(obj.source, collected) || null;
  }
  if (manualRequired) {
    manual = validateManual(obj.manual, errors);
  } else if (obj.manual != null) {
    const collected = [];
    manual = validateManual(obj.manual, collected) || null;
  }

  // Optional blocks — validated independently; errors are collected but
  // missing/null blocks are always OK.
  const context = validateContext(obj.context, errors);
  const delegated = validateDelegated(obj.delegated, errors);

  if (errors.length > 0) return { ok: false, errors };

  const spec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    goalId: obj.goalId.trim(),
    kind: obj.kind,
    widget: obj.widget,
    title: obj.title.trim(),
    reasoning: isNonEmptyString(obj.reasoning) ? obj.reasoning.trim() : "",
    source,
    manual,
    context,
    delegated,
    classifiedAt:
      typeof obj.classifiedAt === "number" && obj.classifiedAt > 0
        ? obj.classifiedAt
        : Date.now(),
  };

  return { ok: true, spec };
}

/**
 * Quick predicate — is this value a validated spec? Used by the widget
 * registry to guard against stale/malformed specs in storage.
 */
export function isSpec(value) {
  return validateSpec(value).ok;
}

/**
 * Convenience: build a minimal spec object from a classification result so
 * callers don't need to hand-assemble the nullable fields.
 */
export function buildSpec({
  goalId,
  title,
  kind,
  widget,
  reasoning = "",
  source = null,
  manual = null,
  context = null,
  delegated = null,
  classifiedAt = Date.now(),
}) {
  return validateSpec({
    schemaVersion: SPEC_SCHEMA_VERSION,
    goalId,
    title,
    kind,
    widget,
    reasoning,
    source,
    manual,
    context,
    delegated,
    classifiedAt,
  });
}

export { SPEC_KINDS, SPEC_VARIANTS };
