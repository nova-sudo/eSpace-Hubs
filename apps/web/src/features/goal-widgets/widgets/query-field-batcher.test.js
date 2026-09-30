import test from "node:test";
import assert from "node:assert/strict";

import { createQueryFieldBatcher } from "./query-field-batcher.js";

test("a window's auto fields go out as ONE /query-fields request", async () => {
  const posts = [];
  const q = createQueryFieldBatcher({
    post: async (path, body) => {
      posts.push({ path, body });
      return {
        ok: true,
        status: 200,
        data: {
          goalId: body.goalId,
          results: {
            f1: { goalId: "g", fieldId: "f1", value: 3 },
            f2: { ok: false, status: 502, error: { code: "query_upstream_error", message: "nope" } },
          },
        },
      };
    },
  });
  const [a, b] = await Promise.all([
    q({ goalId: "g", fieldId: "f1", periodKey: "2026-Q3", periodPath: [2] }),
    q({ goalId: "g", fieldId: "f2", periodKey: "2026-Q3", periodPath: [2] }),
  ]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, "/integrations/query-fields");
  assert.deepEqual(posts[0].body.fieldIds, ["f1", "f2"]);
  assert.equal(a.ok, true);
  assert.equal(a.data.value, 3);
  assert.equal(b.ok, false);
  assert.equal(b.error.code, "query_upstream_error");
});

test("different windows are different batches", async () => {
  const posts = [];
  const q = createQueryFieldBatcher({
    post: async (path, body) => {
      posts.push(body);
      return { ok: true, status: 200, data: { goalId: body.goalId, fieldId: body.fieldId, value: 1 } };
    },
  });
  await Promise.all([
    q({ goalId: "g", fieldId: "f1", periodPath: [0] }),
    q({ goalId: "g", fieldId: "f1", periodPath: [1] }),
  ]);
  // One field per window → the single route, twice.
  assert.equal(posts.length, 2);
  assert.ok(posts.every((b) => b.fieldId === "f1"));
});

test("a missing batch route (older API) falls back to the single route", async () => {
  const paths = [];
  const q = createQueryFieldBatcher({
    post: async (path, body) => {
      paths.push(path);
      if (path === "/integrations/query-fields") return { ok: false, status: 404, error: { code: "not_found" } };
      return { ok: true, status: 200, data: { fieldId: body.fieldId, value: 7 } };
    },
  });
  const r = await Promise.all([q({ goalId: "g", fieldId: "a" }), q({ goalId: "g", fieldId: "b" })]);
  assert.deepEqual(paths.sort(), ["/integrations/query-field", "/integrations/query-field", "/integrations/query-fields"]);
  assert.equal(r[1].data.value, 7);
});

test("a window-level 429 is handed to every field without re-spending the budget", async () => {
  let calls = 0;
  const q = createQueryFieldBatcher({
    post: async () => {
      calls += 1;
      return { ok: false, status: 429, error: { code: "rate_limited", retryAfterMs: 60_000 } };
    },
  });
  const r = await Promise.all([q({ goalId: "g", fieldId: "a" }), q({ goalId: "g", fieldId: "b" })]);
  assert.equal(calls, 1);
  assert.ok(r.every((x) => x.status === 429));
});
