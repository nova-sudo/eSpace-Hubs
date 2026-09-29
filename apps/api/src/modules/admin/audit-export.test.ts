import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import type { AuditLogEntry } from "../../db/types.js";
import { auditCsvLine, csvCell, CSV_HEADER } from "./audit-export.js";

test("csvCell quotes commas, quotes and newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csvCell neutralises spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
});

test("csvCell serialises objects as compact JSON", () => {
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
});

test("auditCsvLine emits one cell per header column, in order", () => {
  const actor = new ObjectId();
  const row: AuditLogEntry = {
    _id: new ObjectId(),
    orgId: new ObjectId(),
    actorUserId: actor,
    actorRole: "admin",
    action: "user.update",
    targetType: "user",
    targetId: "abc",
    before: { status: "active" },
    after: { status: "disabled" },
    ip: "127.0.0.1",
    ua: "curl",
    ts: new Date("2026-09-01T10:00:00.000Z"),
  };
  const line = auditCsvLine(row, "Mona, Admin");
  assert.ok(line.startsWith(`2026-09-01T10:00:00.000Z,user.update,${actor.toHexString()},"Mona, Admin",admin,user,abc,`));
  assert.ok(line.endsWith(",127.0.0.1,curl"));
  // 11 columns — the two JSON cells each contain one quoted comma-free
  // object, so splitting outside quotes must give the header's width.
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.filter((c) => c !== "") ?? [];
  assert.equal(cells.length, CSV_HEADER.length);
});

test("system rows (no actor) leave the actor cells empty", () => {
  const row: AuditLogEntry = {
    _id: new ObjectId(),
    orgId: new ObjectId(),
    actorUserId: null,
    actorRole: null,
    action: "scheduler.snapshot",
    targetType: null,
    targetId: null,
    before: undefined,
    after: undefined,
    ip: null,
    ua: null,
    ts: new Date("2026-09-01T00:00:00.000Z"),
  };
  assert.equal(auditCsvLine(row, null), "2026-09-01T00:00:00.000Z,scheduler.snapshot,,,,,,,,,");
});
