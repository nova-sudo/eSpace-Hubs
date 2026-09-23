import test from "node:test";
import assert from "node:assert/strict";

import { fetchGoals, getGoalsState, resetGoals, updateL1 } from "./goals-store.js";
import { saveSpec, removeSpec } from "../goal-specs/specs-store.js";

/**
 * Shared goals ride in a separate `assigned` slice: every own-tree save PUTs
 * `l1s` back, and the synthetic "Shared goals" L1 must never go with it.
 */

const SHARED = {
  id: "asg__root",
  title: "Shared goals",
  weightage: 0,
  l2s: [{ id: "asg_65f0c0ffee0000000000abcd", title: "Weekly demo" }],
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("PUT /goals never carries the shared-goals L1; a 409 keeps `assigned`", async () => {
  const calls = [];
  const original = globalThis.fetch;
  let putStatus = 200;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if ((init.method || "GET") === "GET") {
      return jsonResponse(200, {
        l1s: [{ id: "l1", title: "Own", weightage: 100, l2s: [] }],
        assigned: [SHARED],
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    }
    if (putStatus === 409) {
      return jsonResponse(409, {
        error: {
          code: "goals_conflict",
          message: "conflict",
          details: { current: { l1s: [], assigned: [SHARED], updatedAt: "2026-09-02T00:00:00.000Z" } },
        },
      });
    }
    return jsonResponse(200, { l1s: init.body ? JSON.parse(init.body).l1s : [], assigned: [SHARED], updatedAt: "2026-09-03T00:00:00.000Z" });
  };
  try {
    resetGoals();
    await fetchGoals();
    assert.equal(getGoalsState().assigned.length, 1);
    assert.equal(getGoalsState().l1s.length, 1);

    updateL1("l1", { title: "Own renamed" });
    await new Promise((r) => setTimeout(r, 0));
    const put = calls.find((c) => c.method === "PUT");
    assert.ok(put, "a PUT was sent");
    assert.deepEqual(put.body.l1s.map((l1) => l1.id), ["l1"]);

    putStatus = 409;
    updateL1("l1", { title: "Again" });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(getGoalsState().assigned[0].id, "asg__root");
  } finally {
    globalThis.fetch = original;
    resetGoals();
  }
});

test("spec writes on a shared goal are refused client-side, with no request", () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return jsonResponse(200, {});
  };
  try {
    const res = saveSpec({ goalId: "asg_65f0c0ffee0000000000abcd", widget: "COMPOSED" });
    assert.equal(res.ok, false);
    removeSpec("asg_65f0c0ffee0000000000abcd");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});
