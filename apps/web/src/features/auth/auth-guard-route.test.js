import test from "node:test";
import assert from "node:assert/strict";

import { guardTarget } from "./guard-target.js";

const base = { status: "active", totpEnrolled: true, onboardingCompletedAt: "2026-11-09T00:00:00Z" };

test("unverified email is sent to the inbox screen from anywhere", () => {
  assert.equal(guardTarget({ user: { ...base, status: "pending_email", totpEnrolled: false, onboardingCompletedAt: null }, pathname: "/dev" }), "/verify-email-pending");
});

test("unverified email stays on the inbox screen (no loop)", () => {
  assert.equal(guardTarget({ user: { ...base, status: "pending_email" }, pathname: "/verify-email-pending" }), null);
});

test("verified user leaves the inbox screen", () => {
  assert.equal(guardTarget({ user: base, pathname: "/verify-email-pending" }), "/");
});

test("active user without TOTP goes to /totp-setup", () => {
  assert.equal(guardTarget({ user: { ...base, totpEnrolled: false }, pathname: "/dev" }), "/totp-setup");
});

test("enrolled user without onboarding goes to /onboarding", () => {
  assert.equal(guardTarget({ user: { ...base, onboardingCompletedAt: null }, pathname: "/dev" }), "/onboarding");
});

test("fully set-up user is left alone", () => {
  assert.equal(guardTarget({ user: base, pathname: "/dev" }), null);
});

test("signed-out or TOTP-pending session goes to login with next", () => {
  assert.equal(guardTarget({ user: null, pathname: "/dev/goals" }), "/login?next=%2Fdev%2Fgoals");
  assert.equal(guardTarget({ user: base, needsTotp: true, pathname: "/login" }), "/login");
});

test("pending_admin no longer traps anyone", () => {
  assert.equal(guardTarget({ user: { ...base, status: "pending_admin" }, pathname: "/dev" }), null);
});
