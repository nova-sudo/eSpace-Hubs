import test from "node:test";
import assert from "node:assert/strict";

import { selectTemplate } from "./packet-model.js";

test("selectTemplate: v1 packets use the legacy view", () => {
  assert.equal(selectTemplate({ version: 1, markdown: "#" }), "legacy");
  assert.equal(selectTemplate({ markdown: "#" }), "legacy");
});

test("selectTemplate: v2 with a known template picks it", () => {
  assert.equal(selectTemplate({ version: 2, template: "deck" }), "deck");
});

test("selectTemplate: v2 with an unknown template is unknown", () => {
  assert.equal(selectTemplate({ version: 2, template: "x" }), "unknown");
});
