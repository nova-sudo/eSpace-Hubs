import test from "node:test";
import assert from "node:assert/strict";

import { aiRouter } from "./routes.js";
import { gradeGoalTierCacheHandler, gradeGoalTierHandler } from "./controller.js";

type Layer = { route?: { path: string; stack: Array<{ handle: unknown }> } };

test("tier-grade cache hits are answered BEFORE the limiter (no slot spent)", () => {
  const layer = (aiRouter.stack as unknown as Layer[]).find(
    (l) => l.route?.path === "/grade-goal-tier",
  );
  assert.ok(layer?.route, "route mounted");
  const handles = layer.route.stack.map((s) => s.handle);
  const cacheAt = handles.indexOf(gradeGoalTierCacheHandler);
  const gradeAt = handles.indexOf(gradeGoalTierHandler);
  assert.ok(cacheAt > 0, "cache gate mounted after auth");
  assert.equal(gradeAt, handles.length - 1, "grader last");
  // Exactly one middleware (the limiter) between the gate and the grader.
  assert.equal(gradeAt - cacheAt, 2);
});
