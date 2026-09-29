import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  HUBS,
  resolveHubsForCapabilities,
  type HubDefinition,
} from "@espace-devhub/shared/hubs";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";

import type { HubConfig } from "../../db/types.js";
import { mergeHubOverride, resolveVisibleHubs } from "./merge.js";

const dev = HUBS.dev as HubDefinition;

function override(hubId: string, fields: Partial<HubConfig>): HubConfig {
  return {
    _id: new ObjectId(),
    orgId: new ObjectId(),
    hubId,
    updatedBy: null,
    updatedAt: new Date(),
    ...fields,
  };
}

// ─── mergeHubOverride ────────────────────────────────────────────────

test("no override returns the registry default untouched and enabled", () => {
  const r = mergeHubOverride(dev, null);
  assert.equal(r.enabled, true);
  assert.equal(r.hub, dev);
});

test("enabled: false disables; true / null / missing leave the hub visible", () => {
  assert.equal(mergeHubOverride(dev, override("dev", { enabled: false })).enabled, false);
  assert.equal(mergeHubOverride(dev, override("dev", { enabled: true })).enabled, true);
  assert.equal(mergeHubOverride(dev, override("dev", { enabled: null })).enabled, true);
  assert.equal(mergeHubOverride(dev, override("dev", {})).enabled, true);
});

test("label / description override only when non-empty strings", () => {
  const r = mergeHubOverride(dev, override("dev", { label: "Engineering", description: "" }));
  assert.equal(r.hub.label, "Engineering");
  assert.equal(r.hub.description, dev.description);
  const n = mergeHubOverride(dev, override("dev", { label: null }));
  assert.equal(n.hub.label, dev.label);
});

test("allowedIntegrations and departments REPLACE; an empty array is meaningful", () => {
  const r = mergeHubOverride(
    dev,
    override("dev", { allowedIntegrations: [], departments: ["platform"] }),
  );
  assert.deepEqual(r.hub.allowedIntegrations, []);
  assert.deepEqual(r.hub.departments, ["platform"]);
  const n = mergeHubOverride(dev, override("dev", { allowedIntegrations: null }));
  assert.deepEqual(n.hub.allowedIntegrations, dev.allowedIntegrations);
});

test("pages merge partially: null removes a slot, a string overrides, others pass through", () => {
  const r = mergeHubOverride(
    dev,
    override("dev", { pages: { evidence: null, goals: "custom:goals" } }),
  );
  assert.equal("evidence" in r.hub.pages, false);
  assert.equal(r.hub.pages.goals, "custom:goals");
  assert.equal(r.hub.pages.dashboard, dev.pages.dashboard);
});

test("invalid page values are ignored rather than written", () => {
  const r = mergeHubOverride(
    dev,
    override("dev", {
      pages: { goals: "" as unknown as string, dashboard: 7 as unknown as string },
    }),
  );
  assert.equal(r.hub.pages.goals, dev.pages.goals);
  assert.equal(r.hub.pages.dashboard, dev.pages.dashboard);
});

test("the merge never mutates the frozen registry default", () => {
  mergeHubOverride(dev, override("dev", { pages: { evidence: null }, label: "X" }));
  assert.equal(HUBS.dev.label, "Dev Hub");
  assert.ok("evidence" in HUBS.dev.pages);
});

// ─── resolveVisibleHubs (/hubs/me) ───────────────────────────────────

const devCaps = new Set([CAPABILITIES.HUB_DEV_ACCESS]);

test("a dev sees the dev hub with its override applied", () => {
  const overrides = new Map([["dev", override("dev", { label: "Eng" })]]);
  const r = resolveVisibleHubs(resolveHubsForCapabilities(devCaps), overrides);
  assert.deepEqual(r.hubs.map((h) => h.id), ["dev"]);
  assert.equal(r.hubs[0]?.label, "Eng");
  assert.equal(r.fallback, false);
});

test("a disabled hub drops out while another allowed hub stays", () => {
  const caps = new Set([CAPABILITIES.HUB_DEV_ACCESS, CAPABILITIES.HUB_QA_ACCESS]);
  const overrides = new Map([["dev", override("dev", { enabled: false })]]);
  const r = resolveVisibleHubs(resolveHubsForCapabilities(caps), overrides);
  assert.deepEqual(r.hubs.map((h) => h.id), ["qa"]);
  assert.equal(r.fallback, false);
});

test("every allowed hub disabled → fallback to the CAPABILITY-ALLOWED set only", () => {
  // Admin hub, QA and Manager are also disabled; the dev must never be
  // handed them just because their own hub was hidden (§3.2).
  const overrides = new Map(
    ["admin", "dev", "qa", "manager"].map((id) => [id, override(id, { enabled: false })]),
  );
  const r = resolveVisibleHubs(resolveHubsForCapabilities(devCaps), overrides);
  assert.equal(r.fallback, true);
  assert.deepEqual(r.hubs.map((h) => h.id), ["dev"]);
  // Overrides are ignored in the fallback — registry defaults are served.
  assert.equal(r.hubs[0], HUBS.dev);
});

test("a user whose roles grant no hub gets nothing — never a default hub", () => {
  const r = resolveVisibleHubs(resolveHubsForCapabilities(new Set()), new Map());
  assert.deepEqual(r.hubs, []);
  assert.equal(r.fallback, false);
});
