/**
 * Notify every active admin in an org — in-app inbox + email, both
 * best-effort. Callers: onboarding-submit (a self-signup finishing
 * onboarding for the first time — "New teammate joined"), and the BYO
 * approval gate when the submitter has no active manager (the approval
 * goes pending to the org's admins — hub-audit §1.3). Muted kinds and
 * an admin's email opt-out are honoured.
 *
 * "Admin" here means holds the admin role, active status, in this org —
 * approximates `effectiveRoles(u).includes("admin")` as a Mongo query
 * ($or across the legacy singular `role` and the `roles` array) since
 * we're filtering server-side rather than loading every user to check
 * in JS.
 */

import type { ObjectId } from "mongodb";
import { getUsersCollection } from "../db/collections.js";
import type { NotificationKind } from "../db/types.js";
import { createNotification } from "./notifications.js";
import { logger } from "./logger.js";

export interface NotifyOrgAdminsInput {
  orgId: ObjectId;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /** Inbox kind; defaults to "user_pending_approval" (the original caller). */
  kind?: NotificationKind;
  /** Actor who triggered it; null for system events. */
  createdBy?: ObjectId | null;
  /** Skip the email half (inbox only). Default false. */
  inboxOnly?: boolean;
}

export async function notifyOrgAdmins(input: NotifyOrgAdminsInput): Promise<void> {
  try {
    const users = await getUsersCollection();
    const admins = await users
      .find({
        orgId: input.orgId,
        status: "active",
        $or: [{ role: "admin" }, { roles: "admin" }],
      })
      .toArray();

    await Promise.all(
      admins.map(async (admin) => {
        void createNotification({
          orgId: input.orgId,
          userId: admin._id,
          kind: input.kind ?? "user_pending_approval",
          title: input.title,
          body: input.body,
          data: input.data ?? null,
          createdBy: input.createdBy ?? null,
          // The email half (and the admin's "Email me" pref) is handled
          // inside createNotification.
          email: !input.inboxOnly,
        });
      }),
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[admin-notify] failed",
    );
  }
}
