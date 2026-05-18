/**
 * GoalSpec validator — single source of truth for both web and api.
 *
 * Hoisted from apps/web/src/features/goal-specs/schema.js and
 * apps/api/src/modules/ai/classifier/spec-validator.ts (which had
 * drifted apart). Keeps the strict-on-required, permissive-on-optional
 * stance: anything a widget needs to render is enforced; cosmetic
 * fields are accepted or normalised silently.
 *
 * No deps. No IO. Pure function over a JSON object.
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
} from "./types.js";

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
    if (isNonEmptyString(source.filter.label))
      filter.label = source.filter.label.trim();
    if (isNonEmptyString(source.filter.branch))
      filter.branch = source.filter.branch.trim();
    if (isNonEmptyString(source.filter.ticketType))
      filter.ticketType = source.filter.ticketType.trim();
    // Scope a GitHub/GitLab source to a single repo. Value is the
    // "owner/name" or "group/project" slug; the metrics layer filters
    // the merged-MR array via filterMrsByRepo() before computing
    // counts / medians / linkage. Lower-cased here so the runtime
    // comparison is case-insensitive.
    if (isNonEmptyString(source.filter.repo))
      filter.repo = source.filter.repo.trim().toLowerCase();
    // Scope a Jenkins source to a single job slug. Required for
    // jenkins-provider AUTO widgets (DEPLOY_FREQUENCY / LEAD_TIME /
    // BUILD_PASS_RATE) — Jenkins has no cross-job feed. NOT
    // lower-cased: Jenkins job names are case-sensitive on the
    // server side (`/job/Foo/...` differs from `/job/foo/...`).
    if (isNonEmptyString(source.filter.job))
      filter.job = source.filter.job.trim();
    if (Object.keys(filter).length > 0) out.filter = filter;
  }
  const target = validateTarget(source.target, "source", errors);
  if (target) out.target = target;
  return out;
}

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
        errors.push(
          `context.questions[${i}].options: required non-empty for kind "select"`,
        );
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
 * Validate an `untrackable` block.
 *
 * Shape: `{ reason: string }` or null. When present, the spec is
 * marked "intentionally not tracked right now" and `validateSpec`
 * skips the variant/source/manual constraint checks — the widget
 * choice becomes a placeholder for "what we'd track once it's
 * trackable again", and source/manual blocks become optional.
 *
 * Users (or the classifier) reach for this when:
 *   - The goal genuinely can't map to any current widget kind
 *   - The needed integration isn't connected yet
 *   - The goal is too vague to instrument without conversation
 *   - It's a "park this for now" intent
 */
function validateUntrackable(untrackable, errors) {
  if (untrackable == null) return null;
  if (!isObject(untrackable)) {
    errors.push("untrackable: must be an object when present");
    return null;
  }
  if (!isNonEmptyString(untrackable.reason)) {
    errors.push("untrackable.reason: required non-empty string");
    return null;
  }
  return { reason: untrackable.reason.trim() };
}

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
 * Normalises shapes so consumers can trust the output downstream.
 *
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
    errors.push(`widget: must be one of ${ALL_SPEC_KINDS.join(", ")}`);
  }

  if (errors.length > 0) return { ok: false, errors };

  // Untrackable specs short-circuit the source/manual constraint checks
  // below. The widget choice + variant are kept as the user's "what
  // I'd track once it's trackable again" hint, but they don't have to
  // line up with the validator's normal rules while the goal is
  // explicitly parked.
  const untrackable = validateUntrackable(obj.untrackable, errors);

  const widgetMeta = SPEC_KIND_META[obj.widget];

  let source = null;
  let manual = null;
  const meta = widgetMeta || {};

  if (!untrackable) {
    // Soft cross-check: spec variant should align with the widget's
    // declared variant, EXCEPT for hybrid (widget renders both halves).
    if (
      widgetMeta &&
      obj.kind !== SPEC_VARIANTS.HYBRID &&
      widgetMeta.variant !== obj.kind
    ) {
      errors.push(
        `widget "${obj.widget}" is a ${widgetMeta.variant} widget but spec kind is "${obj.kind}"`,
      );
    }

    const sourceRequired =
      (obj.kind === SPEC_VARIANTS.AUTO || obj.kind === SPEC_VARIANTS.HYBRID) &&
      meta.requiresSource !== false;
    const manualRequired =
      (obj.kind === SPEC_VARIANTS.MANUAL || obj.kind === SPEC_VARIANTS.HYBRID) &&
      meta.requiresManual !== false;

    if (sourceRequired) {
      source = validateSource(obj.source, errors);
    } else if (obj.source != null) {
      // Optional pass-through: widget doesn't need it, accept silently.
      const collected = [];
      source = validateSource(obj.source, collected) || null;
    }
    if (manualRequired) {
      manual = validateManual(obj.manual, errors);
    } else if (obj.manual != null) {
      const collected = [];
      manual = validateManual(obj.manual, collected) || null;
    }
  } else {
    // Even when untrackable, run source/manual through the validator
    // permissively so a future "make trackable" flip doesn't drop
    // partial work the user/AI already laid down. We never push into
    // `errors` here — bad shapes just don't survive.
    if (obj.source != null) {
      const collected = [];
      source = validateSource(obj.source, collected) || null;
    }
    if (obj.manual != null) {
      const collected = [];
      manual = validateManual(obj.manual, collected) || null;
    }
  }

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
    untrackable,
    classifiedAt:
      typeof obj.classifiedAt === "number" && obj.classifiedAt > 0
        ? obj.classifiedAt
        : Date.now(),
  };

  return { ok: true, spec };
}

/** Predicate — is this value a validated spec? */
export function isSpec(value) {
  return validateSpec(value).ok;
}

/**
 * Convenience: build a minimal spec object from a classification
 * result so callers don't need to hand-assemble the nullable fields.
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
  untrackable = null,
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
    untrackable,
    classifiedAt,
  });
}
