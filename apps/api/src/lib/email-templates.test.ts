import test from "node:test";
import assert from "node:assert/strict";

import {
  renderDigestEmail,
  renderInviteEmail,
  renderPasswordResetEmail,
} from "./email-templates.js";

test("invite: sky tone, activate cta, expiry note, eSpace Hubs subject", () => {
  const r = renderInviteEmail({
    displayName: "Omar",
    orgName: "eSpace",
    acceptUrl: "https://app/accept?t=1",
    expiresInDays: 7,
    inviterDisplayName: "Sara",
  });
  assert.equal(r.subject, "You're invited to eSpace on eSpace Hubs");
  assert.ok(r.html.includes("#e0eafe"));
  assert.ok(r.html.includes("Activate your account"));
  assert.ok(r.html.includes('href="https://app/accept?t=1"'));
  assert.ok(r.text.includes("7 days"));
  assert.ok(!r.html.includes("Manage emails"));
});

test("reset: sky tone, reset cta, ip/browser in subtitle, eSpace Hubs subject", () => {
  const r = renderPasswordResetEmail({
    displayName: "Omar",
    resetUrl: "https://app/reset?t=1",
    expiresInHours: 1,
    ip: "1.2.3.4",
    userAgent: "Chrome",
  });
  assert.equal(r.subject, "Reset your eSpace Hubs password");
  assert.ok(r.html.includes("#e0eafe"));
  assert.ok(r.html.includes("Reset your password"));
  assert.ok(r.html.includes("1.2.3.4"));
  assert.ok(r.html.includes("Chrome"));
  assert.ok(r.text.includes("1 hour"));
});

const digest = {
  week: "W46",
  overdue: [
    { title: "W45 check-in", when: "Thu 6 Nov" },
    { title: "Incident write-up", when: "Wed 5 Nov" },
  ],
  dueSoon: [
    { title: "Review log", when: "Tue" },
    { title: "Mentoring", when: "Thu" },
    { title: "Q4 demo", when: "Thu" },
  ],
  approvals: 1,
  sharedOwed: 0,
  unread: 4,
};

test("digest: title, subtitle, groups and cta", () => {
  const r = renderDigestEmail(digest);
  assert.ok(r.html.includes("Your week · W46"));
  assert.ok(r.html.includes("2 overdue · 3 due this week · 1 approval"));
  assert.ok(r.html.includes("Overdue"));
  assert.ok(r.html.includes("Due this week"));
  assert.ok(r.html.includes("Waiting on you"));
  assert.ok(r.html.includes("#ffe4d6")); // peach badge for overdue rows
  assert.ok(r.html.includes("#fbf3c4")); // lemon badge for due rows
  assert.ok(r.html.includes("Open eSpace Hubs"));
  assert.ok(r.html.includes("Manage emails"));
});

test("digest: Waiting on you only when approvals > 0", () => {
  const r = renderDigestEmail({ ...digest, approvals: 0 });
  assert.ok(!r.html.includes("Waiting on you"));
});

test("digest caps each group at 10 rows", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ title: `Item ${i}`, when: "Tue" }));
  const r = renderDigestEmail({ ...digest, dueSoon: many });
  assert.ok(r.text.includes("Item 9"));
  assert.ok(!r.text.includes("Item 10"));
});

test("digest subject keeps today's shape", () => {
  assert.equal(
    renderDigestEmail(digest).subject,
    "eSpace Hubs weekly — 2 overdue, 3 due this week",
  );
  assert.equal(
    renderDigestEmail({ ...digest, overdue: [] }).subject,
    "eSpace Hubs weekly — 3 due this week",
  );
});
