/**
 * Notify every active admin in an org — in-app inbox + email, both
 * best-effort. Callers: onboarding-submit (a self-signup user finishing
 * their profile while still `status: "pending_admin"`), and the BYO
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
import { createNotification, emailAllowed } from "./notifications.js";
import { sendEmail } from "./email.js";
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
        });
        if (input.inboxOnly) return;
        // Respect the admin's own "email me" preference (Settings →
        // Notifications) — the inbox row above still lands.
        if (!(await emailAllowed(input.orgId, admin._id))) return;
        const r = await sendEmail({
          to: admin.email,
          subject: input.title,
          text: input.body,
        });
        if (!r.ok) {
          logger.warn(
            { adminId: admin._id.toHexString(), reason: r.reason },
            "[admin-notify] email failed",
          );
        }
      }),
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[admin-notify] failed",
    );
  }
}
