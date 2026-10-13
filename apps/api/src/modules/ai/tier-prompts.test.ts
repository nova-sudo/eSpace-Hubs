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
});
