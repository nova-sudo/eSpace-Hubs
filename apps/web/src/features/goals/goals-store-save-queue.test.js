import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchGoals,
  flushPendingGoalsSave,
  getGoalsState,
  isGoalsSaveInFlight,
  resetGoals,
  updateL1,
  addL1,
  flushGoalsOnPageHide,
} from "./goals-store.js";

/**
 * Goal saves are serialised: one PUT on the wire at a time, the next one
 * echoes the `updatedAt` the previous one returned, and edits made while a
 * PUT is out coalesce into ONE follow-up save carrying the latest tree.
 * Before this, a second debounced save raced the first on the same token,
 * 409'd, and the text typed in between vanished.
 */

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake server with the real optimistic-concurrency rule; PUTs are held until released. */
function fakeServer() {
  let version = 1;
  const stamp = () => `2026-09-0${version}T00:00:00.000Z`;
  let tree = [{ id: "l1", title: "Own", weightage: 100, l2s: [] }];
  const puts = [];
  const held = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    if (method === "GET") return jsonResponse(200, { l1s: tree, assigned: [], updatedAt: stamp() });
    const body = JSON.parse(init.body);
    puts.push({ body, keepalive: init.keepalive === true });
    await new Promise((release) => held.push(release));
    if (body.updatedAt !== stamp()) {
      return jsonResponse(409, {
        error: { code: "goals_conflict", message: "conflict", details: { current: { l1s: tree, updatedAt: stamp() } } },
      });
    }
    version += 1;
    tree = body.l1s;
    return jsonResponse(200, { l1s: tree, updatedAt: stamp() });
  };
  return {
    fetch,
    puts,
    releaseNext: async () => {
      while (held.length === 0) await tick();
      held.shift()();
      await tick();
      await tick();
    },
    tree: () => tree,
  };
}

test("a save queued behind an in-flight PUT waits and uses the fresh token", async () => {
  const server = fakeServer();
  const original = globalThis.fetch;
  globalThis.fetch = server.fetch;
  try {
    resetGoals();
    await fetchGoals();

    updateL1("l1", { title: "First" });
    const first = flushPendingGoalsSave();
    await tick();
    assert.equal(server.puts.length, 1, "PUT 1 is on the wire");
    assert.equal(isGoalsSaveInFlight(), true);

    // More typing while PUT 1 is out, flushed twice — must NOT hit the wire yet.
    updateL1("l1", { title: "First and more" });
    const second = flushPendingGoalsSave();
    updateL1("l1", { title: "First and more still" });
    const third = flushPendingGoalsSave();
    await tick();
    assert.equal(server.puts.length, 1, "no second PUT while the first is in flight");
    assert.equal(second, third, "edits made meanwhile coalesce into one follow-up save");

    await server.releaseNext();
    assert.deepEqual(await first, { ok: true });
    assert.equal(server.puts.length, 2, "the follow-up goes out once PUT 1 settles");
    assert.equal(server.puts[1].body.updatedAt, "2026-09-02T00:00:00.000Z", "it echoes PUT 1's token");
    assert.equal(server.puts[1].body.l1s[0].title, "First and more still", "it carries the latest tree");

    await server.releaseNext();
    assert.deepEqual(await second, { ok: true });
    assert.equal(getGoalsState().error, null, "no conflict");
    assert.equal(getGoalsState().l1s[0].title, "First and more still");
    assert.equal(server.tree()[0].title, "First and more still");
    assert.equal(server.puts.length, 2);
  } finally {
    globalThis.fetch = original;
    resetGoals();
  }
});

test("a structural change after a pending edit rides the same queue", async () => {
  const server = fakeServer();
  const original = globalThis.fetch;
  globalThis.fetch = server.fetch;
  try {
    resetGoals();
    await fetchGoals();

    updateL1("l1", { title: "Edited" });
    const first = flushPendingGoalsSave();
    await tick();
    updateL1("l1", { title: "Edited twice" });
    addL1(); // flushes the pending edit, then queues the add — one follow-up save
    await tick();
    assert.equal(server.puts.length, 1);

    await server.releaseNext();
    await first;
    assert.equal(server.puts.length, 2);
    assert.equal(server.puts[1].body.l1s.length, 2, "the add is in the follow-up");
    assert.equal(server.puts[1].body.l1s[0].title, "Edited twice", "so is the edit before it");
    await server.releaseNext();
    assert.equal(getGoalsState().error, null);
    assert.equal(server.tree().length, 2);
  } finally {
    globalThis.fetch = original;
    resetGoals();
  }
});

test("pagehide sends the pending edit with keepalive", async () => {
  const server = fakeServer();
  const original = globalThis.fetch;
  globalThis.fetch = server.fetch;
  try {
    resetGoals();
    await fetchGoals();
    updateL1("l1", { title: "Closing the tab" });
    flushGoalsOnPageHide();
    await tick();
    assert.equal(server.puts.length, 1);
    assert.equal(server.puts[0].keepalive, true, "the request may outlive the page");
    assert.equal(server.puts[0].body.l1s[0].title, "Closing the tab");
    await server.releaseNext();
    flushGoalsOnPageHide();
    await tick();
    assert.equal(server.puts.length, 1, "nothing pending, nothing sent");
  } finally {
    globalThis.fetch = original;
    resetGoals();
  }
});
