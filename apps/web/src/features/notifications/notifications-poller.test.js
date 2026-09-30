import test from "node:test";
import assert from "node:assert/strict";

import { createNotificationsPoller } from "./notifications-poller.js";

function fakeDoc() {
  const listeners = new Set();
  return {
    visibilityState: "visible",
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    fire(state) {
      this.visibilityState = state;
      for (const fn of listeners) fn();
    },
  };
}

function harness() {
  let clock = 1_000_000;
  const timers = new Map();
  let nextId = 1;
  const doc = fakeDoc();
  const pulls = [];
  const p = createNotificationsPoller({
    fetchNow: () => pulls.push(clock),
    intervalMs: 90_000,
    doc,
    setIntervalFn: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearIntervalFn: (id) => timers.delete(id),
    now: () => clock,
  });
  return {
    p,
    doc,
    pulls,
    timers,
    advance(ms) {
      clock += ms;
    },
  };
}

test("one shared interval however many hooks mount", () => {
  const h = harness();
  h.p.acquire();
  h.p.acquire();
  assert.equal(h.timers.size, 1);
  h.p.release();
  assert.equal(h.timers.size, 1);
  h.p.release();
  assert.equal(h.timers.size, 0);
});

test("the poll pauses while hidden and refreshes on return", () => {
  const h = harness();
  h.p.acquire();
  assert.equal(h.p.running, true);
  h.doc.fire("hidden");
  assert.equal(h.p.running, false);
  assert.equal(h.timers.size, 0);
  h.advance(10 * 60_000);
  h.doc.fire("visible");
  assert.equal(h.p.running, true);
  assert.equal(h.pulls.length, 1, "refreshes immediately after a long absence");
});

test("a quick tab flip does not trigger an extra pull", () => {
  const h = harness();
  h.p.acquire();
  h.doc.fire("hidden");
  h.advance(5_000);
  h.doc.fire("visible");
  assert.equal(h.pulls.length, 0);
});

test("a tab opened in the background doesn't poll until shown", () => {
  const h = harness();
  h.doc.visibilityState = "hidden";
  h.p.acquire();
  assert.equal(h.p.running, false);
});
