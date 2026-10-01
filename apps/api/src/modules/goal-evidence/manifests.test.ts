import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import {
  MAX_MANIFEST_GOALS,
  groupManifestRows,
  manifestsFilter,
  parseManifestGoalIds,
} from "./controller.js";
import { HttpError } from "../../middleware/error-handler.js";

test("goalIds parse from repeated params and comma lists, de-duplicated", () => {
  assert.deepEqual(parseManifestGoalIds({ goalIds: ["a", "b", "a"] }), ["a", "b"]);
  assert.deepEqual(parseManifestGoalIds({ goalIds: "a, b,c" }), ["a", "b", "c"]);
});

test("the batch refuses ?userId= — own goals only", () => {
  assert.throws(
    () => parseManifestGoalIds({ goalIds: "a", userId: new ObjectId().toHexString() }),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  );
});

test("empty and oversized batches are rejected", () => {
  assert.throws(() => parseManifestGoalIds({}), HttpError);
  const many = Array.from({ length: MAX_MANIFEST_GOALS + 1 }, (_, i) => `g${i}`);
  assert.throws(() => parseManifestGoalIds({ goalIds: many }), HttpError);
});

test("the Mongo filter is ALWAYS the session's own org + user", () => {
  const session = { orgId: new ObjectId(), userId: new ObjectId() };
  const filter = manifestsFilter(session, ["a", "b"]);
  assert.equal(filter["metadata.orgId"], session.orgId);
  assert.equal(filter["metadata.userId"], session.userId);
  assert.deepEqual(filter["metadata.goalId"], { $in: ["a", "b"] });
});

test("rows are grouped per requested goal; stray goals are dropped", () => {
  const row = (goalId: string, name: string) => ({
    _id: new ObjectId(),
    filename: name,
    length: 10,
    uploadDate: new Date("2026-09-01T00:00:00Z"),
    metadata: { goalId, originalName: name, contentType: "text/plain", periodKey: null },
  });
  const out = groupManifestRows(
    [row("a", "one.txt"), row("zzz", "not-asked.txt"), row("a", "two.txt")],
    ["a", "b"],
  );
  assert.deepEqual(Object.keys(out).sort(), ["a", "b"]);
  assert.deepEqual(out.a.map((f) => f.name), ["one.txt", "two.txt"]);
  assert.deepEqual(out.b, []);
});
