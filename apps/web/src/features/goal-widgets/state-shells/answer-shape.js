/**
 * Shape rules for a typed setup answer, applied in the form — the same
 * per-kind rules the API's query executor applies when the answer is
 * substituted into a query param. Without this the first time a person
 * learns that "/docs/framework.md" is not an acceptable path is a 400 on
 * a tile they are no longer looking at.
 *
 * `kinds` is `contextAnswerKinds(spec)[question.id]`: every param kind this
 * question's answer feeds. A question bound to nothing has no shape rule.
 */

import {
  contextAnswerKinds,
  isValidQueryParam,
  normalizeQueryParamInput,
  queryParamExample,
  queryParamHint,
} from "@espace-devhub/shared/goal-specs";

export { contextAnswerKinds };

/** Does this question's answer go into a query param at all? */
export function isBoundQuestion(question, kinds) {
  return question?.kind === "text" && Array.isArray(kinds) && kinds.length > 0;
}

/**
 * The answer as it will be stored: the habitual extras a person types
 * (leading "/", "./", trailing "/", "#" on an issue number) removed. Only
 * for bound text questions — everything else is trimmed by the form as
 * before.
 */
export function normalizeBoundAnswer(question, value, kinds) {
  if (!isBoundQuestion(question, kinds) || typeof value !== "string") return value;
  return kinds.reduce((acc, kind) => normalizeQueryParamInput(kind, acc), value.trim());
}

/**
 * Why the (normalized) answer would be refused, or null when every kind
 * it feeds accepts it. An empty answer is "unanswered", not a shape
 * problem — the form already handles that.
 */
export function answerProblem(question, value, kinds) {
  if (!isBoundQuestion(question, kinds)) return null;
  const normalized = normalizeBoundAnswer(question, value, kinds);
  if (typeof normalized !== "string" || normalized.length === 0) return null;
  for (const kind of kinds) {
    if (!isValidQueryParam(kind, normalized)) {
      return queryParamHint(kind) || "This answer can't be used in a query.";
    }
  }
  return null;
}

/** The placeholder a bound text question shows when the composer gave none. */
export function boundPlaceholder(question, kinds) {
  if (question?.placeholder) return question.placeholder;
  if (!isBoundQuestion(question, kinds)) return "";
  return queryParamExample(kinds[0]) || "";
}
