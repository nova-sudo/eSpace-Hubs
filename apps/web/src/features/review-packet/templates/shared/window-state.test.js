import test from "node:test";
import assert from "node:assert/strict";
import { classifyWindow, windowTint, windowSummary } from "./window-state.js";

test("classifyWindow maps vocabulary and aliases", () => {
  for (const s of ["filled", "settled", "done", "complete", "met"]) assert.equal(classifyWindow(s), "complete");
  for (const s of ["owed", "missed"]) assert.equal(classifyWindow(s), "missed");
  for (const s of ["current", "open"]) assert.equal(classifyWindow(s), "current");
  assert.equal(classifyWindow("future"), "future");
  assert.equal(classifyWindow("before"), "before");
  assert.equal(classifyWindow("???"), "unknown");
  assert.equal(classifyWindow(undefined), "unknown");
});

test("windowTint returns token classes", () => {
  assert.equal(windowTint("filled").bg, "bg-mint");
  assert.equal(windowTint("owed").bg, "bg-peach");
  assert.equal(windowTint("current").bg, "bg-sky");
  assert.match(windowTint("future").bg, /bg-card-alt/);
  assert.equal(windowTint("x").text, "text-fg");
});

test("windowSummary counts only elapsed windows", () => {
  const s = windowSummary(["filled", "settled", "owed", "current", "future", "before"].map((state) => ({ state })));
  assert.deepEqual(
    { c: s.complete, m: s.missed, e: s.elapsed, t: s.total },
    { c: 2, m: 1, e: 3, t: 6 },
  );
  assert.equal(s.text, "2 of 3 periods complete, 1 missed");
  assert.equal(windowSummary([{ state: "current" }, { state: "current" }]).text, "No periods elapsed yet");
});
