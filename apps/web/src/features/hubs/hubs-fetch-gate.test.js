import test from "node:test";
import assert from "node:assert/strict";

import { canFetchHubs } from "./hubs-fetch-gate.js";

test("unverified self-signups don't fetch hubs (the API would 403 every poll)", () => {
  assert.equal(canFetchHubs({ id: "u1", status: "pending_email" }), false);
});

test("active users fetch hubs", () => {
  assert.equal(canFetchHubs({ id: "u1", status: "active" }), true);
});

test("no user, no fetch", () => {
  assert.equal(canFetchHubs(null), false);
});
