/**
 * Email verification — POST /auth/verify-email.
 *
 * Redeems an `email_verify` token, moves a `pending_email` self-signup
 * to `active`, and flips `emailVerified` on EVERY session the user
 * holds (the link is often opened on another device, while the signup
 * browser sits on the "check your inbox" screen).
 */

import type { Collection } from "mongodb";
import type { AuthToken, Session, User } from "../../db/types.js";
import { HttpError } from "../../middleware/error-handler.js";

export interface VerifyEmailDeps {
  redeem: (token: string) => Promise<AuthToken | null>;
  users: Pick<Collection<User>, "findOne" | "findOneAndUpdate">;
  sessions: Pick<Collection<Session>, "updateMany">;
  now: () => Date;
}

export type VerifyEmailResult = {
  status: "verified" | "already_verified";
  user: User;
};

function invalid(): HttpError {
  return new HttpError(400, "invalid_token", "This link is invalid or has expired.");
}

export async function verifyEmail(
  deps: VerifyEmailDeps,
  token: string,
): Promise<VerifyEmailResult> {
  const redeemed = await deps.redeem(token);
  if (!redeemed) throw invalid();

  const user = await deps.users.findOne({ _id: redeemed.userId });
  if (!user || user.status === "disabled" || user.status === "invited") throw invalid();

  if (user.status !== "pending_email") {
    return { status: "already_verified", user };
  }

  const now = deps.now();
  const updated = await deps.users.findOneAndUpdate(
    { _id: user._id, status: "pending_email" },
    { $set: { status: "active", emailVerifiedAt: now, updatedAt: now } },
    { returnDocument: "after" },
  );
  await deps.sessions.updateMany(
    { userId: user._id },
    { $set: { emailVerified: true } },
  );
  // A concurrent verify won the race — the user is active either way.
  if (!updated) return { status: "already_verified", user: { ...user, status: "active" } };
  return { status: "verified", user: updated };
}
