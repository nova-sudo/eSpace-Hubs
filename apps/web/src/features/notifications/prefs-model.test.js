import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextMuted, withoutUnmutable } from "./prefs-model.js";

describe("notification prefs model", () => {
  it("never keeps an unmutable kind muted", () => {
    assert.deepEqual(withoutUnmutable(["a", "b"], ["b"]), ["a"]);
    assert.deepEqual(nextMuted([], "b", true, ["b"]), []);
  });
  it("toggles only the one kind", () => {
    assert.deepEqual(nextMuted(["a"], "c", true), ["a", "c"]);
    assert.deepEqual(nextMuted(["a", "c"], "a", false), ["c"]);
  });
  it("rolling back one toggle keeps a later one", () => {
    // Mute a, then mute c; a's save fails → undo only a.
    const after = nextMuted(nextMuted([], "a", true), "c", true);
    assert.deepEqual(nextMuted(after, "a", false), ["c"]);
  });
});
