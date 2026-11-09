import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { ALL_NOTIFICATION_KINDS } from "../db/types.js";
import {
  NOTIFICATION_EMAIL,
  decideNotificationEmail,
  renderNotificationEmail,
} from "./notification-email.js";

const prefs = { muted: [], email: true };
const active = { email: "a@b.c", status: "active" };

test("every kind has an email config", () => {
  for (const k of ALL_NOTIFICATION_KINDS) {
    assert.ok(NOTIFICATION_EMAIL[k], `missing ${k}`);
    assert.ok(NOTIFICATION_EMAIL[k].cta.length > 0);
    assert.ok(NOTIFICATION_EMAIL[k].reason.length > 0);
  }
});

test("caller opt-out wins", () => {
  assert.deepEqual(
    decideNotificationEmail({ prefs, kind: "goal_due_soon", optOut: true, recipient: active }),
    { send: false, skip: "caller-opt-out" },
  );
});

test("email pref off → email-off, even for an unmutable kind", () => {
  assert.deepEqual(
    decideNotificationEmail({
      prefs: { muted: [], email: false },
      kind: "goal_submitted",
      optOut: false,
      recipient: active,
    }),
    { send: false, skip: "email-off" },
  );
});

test("muted mutable kind → muted", () => {
  assert.deepEqual(
    decideNotificationEmail({
      prefs: { muted: ["goal_due_soon"], email: true },
      kind: "goal_due_soon",
      optOut: false,
      recipient: active,
    }),
    { send: false, skip: "muted" },
  );
});

test("unmutable kind in muted list still sends", () => {
  assert.deepEqual(
    decideNotificationEmail({
      prefs: { muted: ["goal_submitted"], email: true },
      kind: "goal_submitted",
      optOut: false,
      recipient: active,
    }),
    { send: true },
  );
});

test("missing / emailless / non-active recipient → no-recipient", () => {
  for (const recipient of [
    null,
    { email: null, status: "active" },
    { email: "", status: "active" },
    { email: "a@b.c", status: "invited" },
    { email: "a@b.c", status: "pending_admin" },
    { email: "a@b.c", status: "disabled" },
  ]) {
    assert.deepEqual(
      decideNotificationEmail({ prefs, kind: "goal_due_soon", optOut: false, recipient }),
      { send: false, skip: "no-recipient" },
    );
  }
});

test("active recipient, defaults → send", () => {
  assert.deepEqual(
    decideNotificationEmail({ prefs, kind: "goal_due_soon", optOut: false, recipient: active }),
    { send: true },
  );
});

test("renderNotificationEmail: cta, mute link rules, escaping", () => {
  const id = new ObjectId();
  const due = renderNotificationEmail({
    _id: id,
    kind: "goal_due_soon",
    title: 'Due soon: <b>"Log"</b>',
    body: "Log it before Tue.",
    data: null,
  });
  assert.equal(due.subject, 'Due soon: <b>"Log"</b>');
  assert.ok(due.html.includes(`/n/${id.toHexString()}`));
  assert.ok(due.html.includes("&lt;b&gt;"));
  assert.ok(due.html.includes("Mute this kind"));
  assert.ok(due.html.includes("#fbf3c4"));

  const sub = renderNotificationEmail({
    _id: id,
    kind: "goal_submitted",
    title: "A goal needs your approval",
    body: "Omar submitted it.",
    data: null,
  });
  assert.ok(!sub.html.includes("Mute this kind"));
  assert.ok(sub.html.includes("Manage emails"));
  assert.ok(sub.html.includes("Review tracker"));
});
