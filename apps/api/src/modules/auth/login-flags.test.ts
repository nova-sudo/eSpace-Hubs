/**
 * The session flags a password login mints. Regression: an unverified
 * self-signup who logged out and back in got emailVerified=true (the
 * mintSession default) and skipped the email gate.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loginSessionFlags } from "./login-flags.js";

const enrolled = { totpEnrolledAt: new Date(), totpSecret: "enc" };
const fresh = { totpEnrolledAt: null, totpSecret: null };

test("pending_email login keeps the email gate closed", () => {
  const f = loginSessionFlags({ status: "pending_email", ...fresh }, false);
  assert.equal(f.emailVerified, false);
});

test("active login is email-verified", () => {
  assert.equal(loginSessionFlags({ status: "active", ...enrolled }, false).emailVerified, true);
});

test("enrolled user needs TOTP unless the browser is trusted", () => {
  assert.deepEqual(loginSessionFlags({ status: "active", ...enrolled }, false), {
    needsTotp: true, totpVerified: false, totpEnrolled: true, emailVerified: true,
  });
  assert.deepEqual(loginSessionFlags({ status: "active", ...enrolled }, true), {
    needsTotp: false, totpVerified: true, totpEnrolled: true, emailVerified: true,
  });
});

test("user without TOTP is verified at step 1 but not enrolled", () => {
  assert.deepEqual(loginSessionFlags({ status: "active", ...fresh }, false), {
    needsTotp: false, totpVerified: true, totpEnrolled: false, emailVerified: true,
  });
});
