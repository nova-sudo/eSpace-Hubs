import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  CAPABILITIES,
  resolveCapabilities,
} from "@espace-devhub/shared/capabilities";

import type { ReviewPacket } from "../../db/types.js";
import { latestReadingMap, packetAccess } from "./packet-access.js";

const ORG = new ObjectId();
const DEV = new ObjectId();
const MANAGER = new ObjectId();
const OTHER = new ObjectId();

const packet = { orgId: ORG, userId: DEV };
const none = new Set<string>();

test("packetAccess: the submitter reads their own packet as owner", () => {
  assert.equal(
    packetAccess({
      session: { userId: DEV, orgId: ORG, capabilities: none },
      packet,
      owner: { managerId: MANAGER, status: "active" },
    }),
    "owner",
  );
});

test("packetAccess: the owner's current manager reads it as manager", () => {
  assert.equal(
    packetAccess({
      session: { userId: MANAGER, orgId: ORG, capabilities: none },
      packet,
      owner: { managerId: MANAGER, status: "active" },
    }),
    "manager",
  );
});

test("packetAccess: a manager the report was reassigned away from gets null", () => {
  assert.equal(
    packetAccess({
      session: { userId: MANAGER, orgId: ORG, capabilities: none },
      packet,
      owner: { managerId: OTHER, status: "active" },
    }),
    null,
  );
});

test("packetAccess: a disabled report's manager gets null", () => {
  assert.equal(
    packetAccess({
      session: { userId: MANAGER, orgId: ORG, capabilities: none },
      packet,
      owner: { managerId: MANAGER, status: "disabled" },
    }),
    null,
  );
});

test("packetAccess: an org admin reads any packet as admin", () => {
  assert.equal(
    packetAccess({
      session: {
        userId: OTHER,
        orgId: ORG,
        capabilities: resolveCapabilities(["admin"]),
      },
      packet,
      owner: { managerId: MANAGER, status: "active" },
    }),
    "admin",
  );
  assert.ok(resolveCapabilities(["admin"]).has(CAPABILITIES.ADMIN_USERS_MANAGE));
});

test("packetAccess: an unrelated user gets null", () => {
  assert.equal(
    packetAccess({
      session: { userId: OTHER, orgId: ORG, capabilities: resolveCapabilities(["dev"]) },
      packet,
      owner: { managerId: MANAGER, status: "active" },
    }),
    null,
  );
});

test("packetAccess: a packet in another org is null even for its owner or an admin", () => {
  const foreign = { orgId: new ObjectId(), userId: DEV };
  for (const userId of [DEV, MANAGER, OTHER]) {
    assert.equal(
      packetAccess({
        session: {
          userId,
          orgId: ORG,
          capabilities: resolveCapabilities(["admin"]),
        },
        packet: foreign,
        owner: { managerId: MANAGER, status: "active" },
      }),
      null,
    );
  }
});

test("latestReadingMap: v2 reads payload.objectives[].goals[]", () => {
  const v2 = {
    version: 2,
    payload: {
      objectives: [
        { id: "l1", title: "A", weight: null, goals: [{ id: "g1", reading: "41 merged PRs" }, { id: "g2" }] },
        { id: "l2", title: "B", weight: null, goals: [{ id: "g3", reading: "3 of 4" }] },
      ],
    },
    goals: [{ goalId: "g1", reading: "stale row" }],
  } as unknown as Pick<ReviewPacket, "version" | "payload" | "goals">;
  const map = latestReadingMap(v2);
  assert.deepEqual(
    [...map.entries()],
    [
      ["g1", "41 merged PRs"],
      ["g2", null],
      ["g3", "3 of 4"],
    ],
  );
});

test("latestReadingMap: v1 reads the flat goals[] rows", () => {
  const v1 = {
    goals: [
      { goalId: "g1", title: "x", l1Title: "y", tier: null, reading: "5 PRs", statusLabel: null },
      { goalId: "g2", title: "x", l1Title: "y", tier: null, reading: null, statusLabel: null },
    ],
  } as Pick<ReviewPacket, "version" | "payload" | "goals">;
  assert.deepEqual([...latestReadingMap(v1).entries()], [
    ["g1", "5 PRs"],
    ["g2", null],
  ]);
});

test("latestReadingMap: no packet is an empty map", () => {
  assert.equal(latestReadingMap(null).size, 0);
});
