import test from "node:test";
import assert from "node:assert/strict";

import { CAPABILITIES } from "../capabilities/capabilities.js";
import { resolveCapabilities } from "../capabilities/roles.js";
import {
  HUBS,
  HUB_ORDER,
  PAGE_SLOTS,
  resolveHubsForCapabilities,
} from "./registry.js";

const ids = (hubs) => hubs.map((h) => h.id);

test("resolveHubsForCapabilities: non-Set input resolves to nothing", () => {
  assert.deepEqual(resolveHubsForCapabilities(null), []);
  assert.deepEqual(resolveHubsForCapabilities([CAPABILITIES.HUB_DEV_ACCESS]), []);
});

test("resolveHubsForCapabilities: an empty capability set reaches no hub", () => {
  assert.deepEqual(resolveHubsForCapabilities(new Set()), []);
});

test("resolveHubsForCapabilities: each hub needs its own access capability", () => {
  assert.deepEqual(ids(resolveHubsForCapabilities(new Set([CAPABILITIES.HUB_DEV_ACCESS]))), ["dev"]);
  assert.deepEqual(ids(resolveHubsForCapabilities(new Set([CAPABILITIES.HUB_QA_ACCESS]))), ["qa"]);
  assert.deepEqual(
    ids(resolveHubsForCapabilities(new Set([CAPABILITIES.HUB_MANAGER_ACCESS]))),
    ["manager"],
  );
  assert.deepEqual(
    ids(resolveHubsForCapabilities(new Set([CAPABILITIES.HUB_ADMIN_ACCESS]))),
    ["admin"],
  );
});

test("resolveHubsForCapabilities: operational caps alone never open a hub", () => {
  const caps = new Set([
    CAPABILITIES.ADMIN_USERS_MANAGE,
    CAPABILITIES.ADMIN_AUDIT_VIEW,
    CAPABILITIES.MANAGER_TEAM_VIEW,
  ]);
  assert.deepEqual(resolveHubsForCapabilities(caps), []);
});

test("resolveHubsForCapabilities: multi-role users get every hub, in HUB_ORDER", () => {
  const caps = resolveCapabilities(["manager", "dev", "admin"]);
  assert.deepEqual(ids(resolveHubsForCapabilities(caps)), ["admin", "dev", "manager"]);
  const order = HUB_ORDER.filter((id) => ["admin", "dev", "manager"].includes(id));
  assert.deepEqual(ids(resolveHubsForCapabilities(caps)), order);
});

test("resolveHubsForCapabilities: reserved roles (hr / po / member) reach no hub yet", () => {
  for (const role of ["hr", "po", "member"]) {
    assert.deepEqual(resolveHubsForCapabilities(resolveCapabilities([role])), [], role);
  }
});

test("every page slot a hub registers is in the PAGE_SLOTS contract", () => {
  for (const hub of Object.values(HUBS)) {
    for (const slot of Object.keys(hub.pages)) {
      assert.ok(PAGE_SLOTS.includes(slot), `${hub.id}.${slot} missing from PAGE_SLOTS`);
    }
  }
});

test("every hub exposes settings and the notifications inbox", () => {
  for (const hub of Object.values(HUBS)) {
    assert.ok(hub.pages.settings, `${hub.id} has no settings`);
    assert.ok(hub.pages.notifications, `${hub.id} has no notifications inbox`);
  }
});
