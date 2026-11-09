/**
 * Self-signup policy: which gate a signup goes through (free domain vs
 * org signup code), the shape of the new user row, and the
 * verification email (which must never fail the signup).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  newSelfSignupUser,
  resolveSignupGate,
  sendVerificationEmail,
} from "./signup-policy.js";
import { HttpError } from "../../middleware/error-handler.js";

const FREE = ["espace.com.eg"];

test("free domain without a code goes through the free gate", () => {
  assert.deepEqual(resolveSignupGate({ email: "a@espace.com.eg", freeDomains: FREE }), { kind: "free" });
});

test("free domain ignores a supplied code", () => {
  assert.deepEqual(
    resolveSignupGate({ email: "a@espace.com.eg", signupCode: "ESP-1", freeDomains: FREE }),
    { kind: "free" },
  );
});

test("other domain with a code goes through the code gate", () => {
  assert.deepEqual(
    resolveSignupGate({ email: "a@gmail.com", signupCode: "ESP-1", freeDomains: FREE }),
    { kind: "code", code: "ESP-1" },
  );
});

test("other domain without a code is rejected with signup_code_required", () => {
  assert.throws(
    () => resolveSignupGate({ email: "a@gmail.com", freeDomains: FREE }),
    (err: unknown) => err instanceof HttpError && err.status === 400 && err.code === "signup_code_required",
  );
});

test("new self-signup user starts unverified with dev access", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const u = newSelfSignupUser({
    orgId: new ObjectId(),
    email: "a@espace.com.eg",
    passwordHash: "h",
    displayName: "A",
    now,
  });
  assert.equal(u.status, "pending_email");
  assert.equal(u.role, "member");
  assert.deepEqual(u.roles, ["dev"]);
  assert.deepEqual(u.allowedHubs, ["dev"]);
  assert.equal(u.primaryHub, "dev");
  assert.equal(u.managerId, null);
  assert.equal(u.emailVerifiedAt, null);
  assert.equal(u.onboardingCompletedAt, null);
});

test("signup succeeds when email send fails", async () => {
  const minted: Array<{ kind: string; ttlMs: number }> = [];
  const sent: Array<{ to: string; text: string }> = [];
  const result = await sendVerificationEmail(
    {
      mintToken: async (input) => {
        minted.push({ kind: input.kind, ttlMs: input.ttlMs });
        return "tok123";
      },
      send: async (msg) => {
        sent.push({ to: msg.to, text: msg.text });
        return { ok: false, reason: "smtp down" };
      },
      appUrl: "https://app.test",
      orgName: "eSpace",
    },
    { _id: new ObjectId(), orgId: new ObjectId(), email: "a@espace.com.eg", displayName: "A" },
    { ip: null, ua: null },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(minted, [{ kind: "email_verify", ttlMs: 86_400_000 }]);
  assert.equal(sent[0]?.to, "a@espace.com.eg");
  assert.match(sent[0]?.text ?? "", /https:\/\/app\.test\/verify-email\?token=tok123/);
});
