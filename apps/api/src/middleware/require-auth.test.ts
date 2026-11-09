/**
 * requireAuth's email-verification gate: unverified self-signups only
 * reach routes that opt out with `requireEmailVerified: false`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { requireAuth } from "./require-auth.js";
import { HttpError } from "./error-handler.js";

function run(session: Record<string, unknown>, opts?: Parameters<typeof requireAuth>[0]): unknown {
  let passed: unknown = "not-called";
  requireAuth(opts)({ session } as unknown as Request, {} as Response, (err?: unknown) => {
    passed = err ?? null;
  });
  return passed;
}

const VERIFIED = { totpVerified: true, totpEnrolled: true };

test("unverified email is blocked with 403 email_unverified", () => {
  const err = run({ ...VERIFIED, emailVerified: false });
  assert.ok(err instanceof HttpError);
  assert.equal(err.status, 403);
  assert.equal(err.code, "email_unverified");
});

test("routes that opt out admit unverified users", () => {
  assert.equal(run({ ...VERIFIED, emailVerified: false }, { requireEmailVerified: false }), null);
});

test("legacy sessions without the flag count as verified", () => {
  assert.equal(run({ ...VERIFIED }), null);
});
