/**
 * Session flags minted by a password login (POST /auth/login).
 *
 * One pure function so every flag is decided — and tested — together.
 * `emailVerified` must be explicit: mintSession defaults it to true,
 * and leaving it out once let an unverified self-signup skip the
 * email gate simply by signing out and back in.
 */

import type { User } from "../../db/types.js";

export interface LoginSessionFlags {
  needsTotp: boolean;
  totpVerified: boolean;
  totpEnrolled: boolean;
  emailVerified: boolean;
}

export function loginSessionFlags(
  user: Pick<User, "status" | "totpEnrolledAt" | "totpSecret">,
  trustedDevice: boolean,
): LoginSessionFlags {
  const totpRequired = user.totpEnrolledAt !== null && user.totpSecret !== null;
  const needsTotp = totpRequired && !trustedDevice;
  return {
    needsTotp,
    totpVerified: !needsTotp,
    totpEnrolled: user.totpEnrolledAt !== null,
    emailVerified: user.status !== "pending_email",
  };
}
