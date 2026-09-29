/**
 * The manager authorization boundary — "a manager can only ever see their
 * own direct reports" — as one small function with its user lookup
 * injected, so the invariant is unit-tested without a database.
 *
 * Every per-report manager route (`/manager/reports/:userId/...`) goes
 * through this. It 404s (never 403s) so the endpoint can't be used to
 * probe whether an arbitrary user id exists:
 *
 *   malformed id                      → 404
 *   id in another org                 → 404 (the lookup is org-scoped)
 *   someone who isn't the caller's
 *   direct report                     → 404
 *   a DISABLED report                 → 404 — they're gone from the
 *                                       roster and the approvals queue
 *                                       too, so every surface agrees
 *   the caller's own active report    → the user doc
 */

import { ObjectId } from "mongodb";
import type { User } from "../../db/types.js";
import { HttpError } from "../../middleware/error-handler.js";

export interface ReportBoundarySession {
  orgId: ObjectId;
  userId: ObjectId;
}

/** Org-scoped user lookup — `getUsersCollection().findOne` in production. */
export type FindOrgUser = (query: {
  _id: ObjectId;
  orgId: ObjectId;
}) => Promise<User | null>;

export const NOT_ON_TEAM_MESSAGE = "That teammate isn't on your team.";

function notOnTeam(): HttpError {
  return new HttpError(404, "not_found", NOT_ON_TEAM_MESSAGE);
}

export async function resolveReportFor(
  session: ReportBoundarySession | null | undefined,
  rawId: unknown,
  findUser: FindOrgUser,
): Promise<User> {
  if (!session) {
    throw new HttpError(401, "unauthenticated", "Login required.");
  }
  // ObjectId.isValid accepts any 12-char string; demand the 24-hex form.
  if (typeof rawId !== "string" || !/^[0-9a-fA-F]{24}$/.test(rawId)) {
    throw notOnTeam();
  }
  const target = await findUser({
    _id: new ObjectId(rawId),
    orgId: session.orgId,
  });
  if (
    !target ||
    // Belt and braces: never trust the lookup to have scoped the org.
    !target.orgId?.equals(session.orgId) ||
    !target.managerId ||
    !target.managerId.equals(session.userId) ||
    target.status === "disabled"
  ) {
    throw notOnTeam();
  }
  return target;
}
