/**
 * Interpret a `POST /goal-specs/:goalId/submit-approval` response (pure).
 *
 * The approval gate is hard: nothing is auto-approved. The server routes
 * the tracker to the user's manager (`approverScope: "manager"`, with
 * `managerName`) or — when no active manager is on file — to the org's
 * admins (`approverScope: "admins"`, `noManager: true`). Either way it
 * stays pending. The UI must say which, and must never imply a manager is
 * reviewing a tracker that went to the admins.
 *
 * Legacy responses (`status: "approved", autoApproved: true`) from before
 * the change are still understood, so an old server can't strand a save.
 */

/** Toast / card copy for a submission routed to the org's admins. */
export const ADMIN_APPROVAL_COPY =
  "Sent to your organisation's admins for approval (you have no manager assigned).";

/** Who the pending card and toasts name when the admins decide. */
export const ADMINS_LABEL = "your organisation's admins";

/** Legacy: shown only for a pre-change server that still auto-approves. */
export const AUTO_APPROVED_COPY =
  "No manager assigned, so this was approved automatically. Ask your admin to assign one if it should be reviewed.";

/**
 * @param {object|null|undefined} data   the submit response body
 * @param {object|null|undefined} prior  the approval block saved before submit
 * @returns {{ approved: boolean, autoApproved: boolean, toAdmins: boolean,
 *   managerName: string|null, approval: object }}
 *   `managerName` is the display name toasts use ("Sent to X for
 *   approval") — "your organisation's admins" when the admins decide.
 */
export function approvalOutcome(data, prior) {
  const submittedAt =
    (typeof data?.submittedAt === "number" && data.submittedAt > 0 && data.submittedAt) ||
    (typeof prior?.submittedAt === "number" && prior.submittedAt > 0 && prior.submittedAt) ||
    undefined;
  const approved = (data?.status || "pending") === "approved";
  if (approved) {
    const autoApproved = data?.autoApproved === true;
    return {
      approved: true,
      autoApproved,
      toAdmins: false,
      managerName: null,
      approval: {
        status: "approved",
        ...(submittedAt ? { submittedAt } : {}),
        ...(autoApproved
          ? { autoApproved: true, autoApprovedReason: data?.reason || "no_manager" }
          : {}),
      },
    };
  }
  const toAdmins = data?.approverScope === "admins" || data?.noManager === true;
  if (toAdmins) {
    return {
      approved: false,
      autoApproved: false,
      toAdmins: true,
      managerName: ADMINS_LABEL,
      approval: {
        status: "pending",
        ...(submittedAt ? { submittedAt } : {}),
        approverScope: "admins",
        noManager: true,
      },
    };
  }
  const managerName =
    typeof data?.managerName === "string" && data.managerName.trim()
      ? data.managerName.trim()
      : null;
  return {
    approved: false,
    autoApproved: false,
    toAdmins: false,
    managerName,
    approval: {
      status: "pending",
      ...(submittedAt ? { submittedAt } : {}),
      ...(data?.approverScope === "manager" ? { approverScope: "manager" } : {}),
      ...(managerName ? { managerName } : {}),
    },
  };
}
