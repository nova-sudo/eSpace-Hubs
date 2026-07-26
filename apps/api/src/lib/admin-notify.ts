/**
 * Notify every active admin in an org — in-app inbox + email, both
 * best-effort. Today's one caller is onboarding-submit (a self-signup
 * user finishing their profile while still `status: "pending_admin"`),
 * so an admin doesn't have to remember to periodically check the admin
 * panel for people waiting on a role/hub assignment.
 *
 * "Admin" here means holds the admin role, active status, in this org —
 * approximates `effectiveRoles(u).includes("admin")` as a Mongo query
 * ($or across the legacy singular `role` and the `roles` array) since
 * we're filtering server-side rather than loading every user to check
 * in JS.
 */

import type { ObjectId } from "mongodb";
import { getUsersCollection } from "../db/collections.js";
import { createNotification } from "./notifications.js";
import { sendEmail } from "./email.js";
import { logger } from "./logger.js";

export interface NotifyOrgAdminsInput {
  orgId: ObjectId;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
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
          kind: "user_pending_approval",
          title: input.title,
          body: input.body,
          data: input.data ?? null,
          createdBy: null,
        });
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
