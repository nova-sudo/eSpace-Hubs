import test from "node:test";
import assert from "node:assert/strict";

import {
  clearTierTransition,
  consumeFillIntent,
  markFillIntent,
  peekFillIntent,
  readTierTransition,
  recordTierTransition,
  resetTierTransitions,
} from "./tier-transitions-store.js";

function withFixedNow(nowMs, fn) {
  const original = Date.now;
  Date.now = () => nowMs;
  try {
    return fn();
  } finally {
    Date.now = original;
  }
}

test("record → read round-trip carries the delta shape + timestamp", () => {
  resetTierTransitions();
  const entry = recordTierTransition("g1", "achieved", "over_achieved");
  assert.equal(entry.direction, "up");
  const read = readTierTransition("g1");
  assert.equal(read.to, "over_achieved");
  assert.ok(typeof read.at === "number");
  clearTierTransition("g1");
  assert.equal(readTierTransition("g1"), null);
});

test("no-op, first-grade, and hold records store nothing", () => {
  resetTierTransitions();
  assert.equal(recordTierTransition("g1", "achieved", "achieved"), null);
  assert.equal(recordTierTransition("g1", null, "achieved"), null);
  assert.equal(
    recordTierTransition("g1", "achieved", "over_achieved", { hold: true }),
    null,
  );
  assert.equal(readTierTransition("g1"), null);
});

// G1.5/G2.4: the double-mounted hook races to record the same move —
// one record, and the second call returns the existing entry untouched.
test("recording the same (goalId, to) twice is idempotent", () => {
  resetTierTransitions();
  const first = recordTierTransition("g1", "achieved", "over_achieved");
  const second = recordTierTransition("g1", "achieved", "over_achieved");
  assert.equal(second.at, first.at);
});

test("records expire at the 60s TTL even without an explicit clear", () => {
  resetTierTransitions();
  withFixedNow(1_000_000, () => {
    recordTierTransition("g1", "achieved", "over_achieved");
  });
  withFixedNow(1_000_000 + 59_000, () => {
    assert.ok(readTierTransition("g1"));
  });
  withFixedNow(1_000_000 + 61_000, () => {
    assert.equal(readTierTransition("g1"), null);
  });
});

test("fill intent: mark → peek → consume, with a 10s TTL", () => {
  resetTierTransitions();
  withFixedNow(2_000_000, () => {
    markFillIntent("g1");
    assert.equal(peekFillIntent("g1"), true);
  });
  withFixedNow(2_000_000 + 11_000, () => {
    assert.equal(peekFillIntent("g1"), false); // expired
  });
  withFixedNow(3_000_000, () => {
    markFillIntent("g2");
    consumeFillIntent("g2");
    assert.equal(peekFillIntent("g2"), false);
  });
});

test("reset wipes transitions AND intents (auth transition)", () => {
  resetTierTransitions();
  recordTierTransition("g1", "achieved", "over_achieved");
  markFillIntent("g1");
  resetTierTransitions();
  assert.equal(readTierTransition("g1"), null);
  assert.equal(peekFillIntent("g1"), false);
});
