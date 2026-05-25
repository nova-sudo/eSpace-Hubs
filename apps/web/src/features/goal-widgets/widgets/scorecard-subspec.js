"use client";

/**
 * Build a full ValidatedSpec-shaped object from a SCORECARD component
 * so the standalone widget Components + check-in editors can consume it
 * uniformly.
 *
 * Why this exists
 * ───────────────
 * The SCORECARD widget keeps each sub-component as a compact
 * `{widget, kind, label, source, manual, ...}` object — half a spec.
 * Three surfaces want to render the full widget body for one of those
 * sub-components:
 *
 *   1. The dashboard SCORECARD modal (`scorecard-component-modal.jsx`)
 *   2. The check-in single-week editor (`goal-row.jsx`)
 *   3. The check-in catch-up grid    (`grid-row.jsx` / `grid-page.jsx`)
 *
 * They all need the same synthetic spec → the same synthetic sub-goalId
 * → the same goal-context seeding rules. Putting that in one helper
 * avoids the bug class where the modal and the check-in derive
 * subtly different sub-ids and the same component appears empty in
 * one surface while populated in the other.
 *
 * Sub-goal id format
 * ──────────────────
 * `${parentGoalId}::sc${componentIndex}` — same convention the
 * dashboard SCORECARD widget already uses for `useGoalInputs` and
 * `useGradedPrs` scoping. Anything reading from `goal-inputs` or
 * `goal-context` keyed on the synthetic id will see the same data
 * the SCORECARD aggregate already sees.
 */

import { readContextFor, saveContextFor } from "@/features/goal-context";

/**
 * Translate a SCORECARD component into a full spec the regular widget
 * Components / check-in editors expect.
 *
 * `parentSpec` carries the parent goal id + classification context;
 * `component` is the entry from `parentSpec.scorecard.components[index]`;
 * `index` is the slot index used to derive the synthetic sub-id.
 */
export function buildSubSpec(parentSpec, component, index) {
  const subGoalId =
    parentSpec?.goalId != null
      ? `${parentSpec.goalId}::sc${index}`
      : `scorecard-component-${index}`;
  const widget = component?.widget || "MERGED_COUNT";
  const title =
    component?.label?.trim() || prettyWidget(widget) || "Component";

  return {
    schemaVersion: 1,
    goalId: subGoalId,
    title,
    reasoning: "",
    kind: component?.kind || "auto",
    widget,
    source: component?.source || null,
    manual: component?.manual || null,
    // CODE_RUBRIC needs `context.questions[*].id === "quality-standards"`
    // for `resolveRubric(spec, answers)` to find the criteria. The
    // criteria themselves live in the goal-context store under the
    // synthetic sub-id (seeded by `seedRubricContextIfNeeded` below).
    context:
      widget === "CODE_RUBRIC"
        ? {
            required: true,
            questions: [
              {
                id: "quality-standards",
                prompt: "What are your code quality standards?",
                kind: "list",
                placeholder: "e.g. test coverage, naming, docs",
              },
            ],
          }
        : null,
    delegated: null,
    untrackable: null,
    scorecard: null,
    firstReviewOnly: component?.firstReviewOnly === true,
    classifiedAt: parentSpec?.classifiedAt || Date.now(),
  };
}

/**
 * Idempotently seed `goal-context` for a CODE_RUBRIC sub-component
 * from its `component.manual.items`. Mirrors the seed effect the
 * SCORECARD modal already runs — pulled here so the check-in
 * surfaces can guarantee the rubric isn't empty even if the user
 * never opened the modal first.
 *
 * Returns true when something was seeded (caller can log), false
 * when there was nothing to do (already seeded, not a rubric, no
 * seed items).
 */
export function seedRubricContextIfNeeded(subGoalId, component) {
  if (!subGoalId) return false;
  if (component?.widget !== "CODE_RUBRIC") return false;
  const existing = readContextFor(subGoalId);
  const hasCriteria =
    Array.isArray(existing?.["quality-standards"]) &&
    existing["quality-standards"].length > 0;
  if (hasCriteria) return false;
  const seed = component?.manual?.items || [];
  if (seed.length === 0) return false;
  saveContextFor(subGoalId, { "quality-standards": seed });
  return true;
}

/**
 * Derive a goal-shaped object from a SCORECARD's parent goal +
 * synthetic sub-spec. The sub-goal inherits dueDate / category /
 * etc. from the parent so editors that read those fields don't see
 * undefined.
 */
export function buildSubGoal(parentGoal, subSpec) {
  return {
    ...(parentGoal || {}),
    id: subSpec.goalId,
    title: subSpec.title,
  };
}

function prettyWidget(widget) {
  if (typeof widget !== "string") return "";
  return widget
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}
