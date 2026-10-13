import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGradeScope, tierSystemPromptFor } from "./tier-prompts.js";

test("window prompt has no pacing rule, goal prompt does", () => {
  assert.match(tierSystemPromptFor("goal"), /judge the PACE/);
  assert.doesNotMatch(tierSystemPromptFor("window"), /judge the PACE/);
  assert.match(tierSystemPromptFor("window"), /ONLY this window/);
});

test("resolveGradeScope: periodKey alone means window", () => {
  assert.equal(resolveGradeScope({ periodKey: "2026-W12" }), "window");
  assert.equal(resolveGradeScope({ periodKey: "__goal__" }), "goal");
  assert.equal(resolveGradeScope({}), "goal");
});

test("resolveGradeScope: explicit scope window wins", () => {
  assert.equal(resolveGradeScope({ scope: "window" }), "window");
  assert.equal(resolveGradeScope({ scope: "goal", periodKey: "__goal__" }), "goal");
  assert.equal(resolveGradeScope({ scope: "goal", periodKey: "2026-W12" }), "window");
});

test("fallback window prompt asks for the pro-rated share", () => {
  const fallback = tierSystemPromptFor("window", { ladderFallback: true });
  assert.match(fallback, /pro-rated share/);
  assert.doesNotMatch(fallback, /cannot reach/);
  assert.doesNotMatch(fallback, /judge the PACE/);
});

test("non-fallback window prompt is unchanged", () => {
  assert.equal(tierSystemPromptFor("window", { ladderFallback: false }), tierSystemPromptFor("window"));
  assert.match(tierSystemPromptFor("window"), /cannot reach it/);
  assert.doesNotMatch(tierSystemPromptFor("window"), /pro-rated share/);
  assert.equal(tierSystemPromptFor("goal", { ladderFallback: true }), tierSystemPromptFor("goal"));
});
