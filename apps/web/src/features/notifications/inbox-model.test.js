import test from "node:test";
import assert from "node:assert/strict";

import { applyMarkRead } from "./inbox-model.js";

const base = {
  items: [
    { id: "a", read: false },
    { id: "b", read: true },
  ],
  unread: 1,
};

test("applyMarkRead: an unread row flips and the count drops", () => {
  const next = applyMarkRead(base, "a");
  assert.ok(next, "a change means the caller POSTs");
  assert.equal(next.items[0].read, true);
  assert.equal(next.unread, 0);
  assert.equal(base.items[0].read, false, "input is not mutated");
});

test("applyMarkRead: already-read or unknown rows are a no-op (no POST)", () => {
  assert.equal(applyMarkRead(base, "b"), null);
  assert.equal(applyMarkRead(base, "zzz"), null);
  assert.equal(applyMarkRead({ items: [], unread: 0 }, "a"), null);
});

test("applyMarkRead: a second call on the result is a no-op (double click → one POST)", () => {
  const once = applyMarkRead(base, "a");
  assert.equal(applyMarkRead(once, "a"), null);
});

test("applyMarkRead: unread never goes negative", () => {
  const next = applyMarkRead({ items: [{ id: "a", read: false }], unread: 0 }, "a");
  assert.equal(next.unread, 0);
});
