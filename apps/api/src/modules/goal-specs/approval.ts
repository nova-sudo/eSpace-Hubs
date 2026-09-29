/**
 * Pure helpers for the Build-Your-Own approval gate (P4) — who a submission
 * is routed to, and how that shows up on the submit response and on reads.
 *
 * Kept free of DB access so the controller does the lookups and these stay
 * unit-testable.
 */

/** The user fields a manager name is derived from. */
export interface ManagerLike {
  displayName?: string | null;
  email?: string | null;
}

/** A manager's display label: displayName, else email, else null. */
export function managerLabel(manager: ManagerLike | null | undefined): string | null {
  if (!manager) return null;
  const name = typeof manager.displayName === "string" ? manager.displayName.trim() : "";
  if (name) return name.slice(0, 200);
  const email = typeof manager.email === "string" ? manager.email.trim() : "";
  return email ? email.slice(0, 200) : null;
}

/**
 * Legacy: before hub-audit §1.3 a submitter with no manager was approved
 * on the spot. Such rows (`approval.autoApproved: true, autoApprovedReason:
 * "no_manager"`) still exist and are still read; nothing writes them now.
 */
export const AUTO_APPROVED_NO_MANAGER = "no_manager" as const;

/** Who an open approval is waiting on. */
export type ApproverScope = "manager" | "admins";

export type SubmitApprovalResponse =
  | {
      status: "pending";
      approverScope: "manager";
      managerId: string;
      managerName: string | null;
      noManager: false;
      submittedAt: number;
      approval: {
        status: "pending";
        submittedAt: number;
        approverScope: "manager";
        managerName?: string;
      };
    }
  | {
      status: "pending";
      approverScope: "admins";
      managerId: null;
      managerName: null;
      noManager: true;
      submittedAt: number;
      approval: {
        status: "pending";
        submittedAt: number;
        approverScope: "admins";
        noManager: true;
      };
    };

/**
 * The submit-approval response body. `submittedAt` is the stored approval's
 * stamp when it has one (the client sets it on save), else `now`. `approval`
 * is the block the client should persist onto the spec.
 *
 * The gate is HARD (docs/manager-hub-plan.md decision #2, hub-audit §1.3):
 * a submitter with no ACTIVE manager is never auto-approved — the tracker
 * stays pending and is routed to the org's admins (`approverScope:
 * "admins"`, `noManager: true`).
 */
export function buildSubmitApprovalResponse(args: {
  managerId: string | null;
  managerName: string | null;
  storedSubmittedAt?: unknown;
  now?: number;
}): SubmitApprovalResponse {
  const submittedAt =
    typeof args.storedSubmittedAt === "number" && args.storedSubmittedAt > 0
      ? args.storedSubmittedAt
      : (args.now ?? Date.now());
  if (!args.managerId) {
    return {
      status: "pending",
      approverScope: "admins",
      managerId: null,
      managerName: null,
      noManager: true,
      submittedAt,
      approval: {
        status: "pending",
        submittedAt,
        approverScope: "admins",
        noManager: true,
      },
    };
  }
  return {
    status: "pending",
    approverScope: "manager",
    managerId: args.managerId,
    managerName: args.managerName,
    noManager: false,
    submittedAt,
    approval: {
      status: "pending",
      submittedAt,
      approverScope: "manager",
      ...(args.managerName ? { managerName: args.managerName } : {}),
    },
  };
}

/**
 * Does this user have a manager who can actually act — present in the org
 * and not disabled? A disabled manager's queue has no reader, so their
 * reports' approvals route to the admins exactly like "no manager".
 */
export function isActiveManager(
  manager: { status?: string | null } | null | undefined,
): boolean {
  return Boolean(manager) && manager?.status !== "disabled";
}

/** Does this spec carry an approval still waiting on (or sent back by) a manager? */
export function hasOpenApproval(spec: unknown): boolean {
  const a = (spec as { approval?: { status?: unknown } } | null)?.approval;
  return a?.status === "pending" || a?.status === "rejected";
}

/**
 * Stamp the CURRENT routing onto an open (pending / rejected) approval block
 * at read time: `approverScope: "manager"` (+ `managerName`) when the user
 * has an active manager, else `approverScope: "admins"` + `noManager: true`
 * — the org's admins decide it (hub-audit §1.3), and the UI must not imply
 * a manager saw it. Closed (approved) or absent approvals pass through
 * untouched. Returns a new spec object; never mutates.
 */
export function withApprovalRouting<T extends Record<string, unknown>>(
  spec: T,
  managerName: string | null,
  hasManager: boolean,
): T {
  if (!hasOpenApproval(spec)) return spec;
  const {
    managerName: _m,
    noManager: _n,
    approverScope: _s,
    ...rest
  } = spec.approval as Record<string, unknown>;
  const approval: Record<string, unknown> = { ...rest };
  if (hasManager) {
    approval.approverScope = "manager";
    if (managerName) approval.managerName = managerName;
  } else {
    approval.approverScope = "admins";
    approval.noManager = true;
  }
  return { ...spec, approval };
}

/**
 * The approval block a `PUT /goal-specs/:goalId` may store. `approval` is
 * SERVER-OWNED: the only transition a client can ask for is (re)submission
 * — `{status:"pending"}`. Everything else (approved / rejected / reviewed*
 * / autoApproved) is written only by the manager and admin decision
 * endpoints, so a forged `approved` block is ignored and the stored one is
 * kept.
 *
 *   - stored absent / pending   → a pending request is accepted (first
 *                                 submit, or the post-submit re-save).
 *                                 A pending stored block is kept as-is so
 *                                 its routing stamps survive.
 *   - stored rejected / approved → a pending request is a RESUBMIT and is
 *                                 accepted only when it carries a
 *                                 `submittedAt` newer than the stored one.
 *                                 A stale editor save still holds the old
 *                                 submission's stamp, so it can't revert a
 *                                 decision someone made in the meantime.
 *   - anything else (no block, or a non-pending block) → the stored block
 *     is kept (null when there is none).
 *
 * Pure; `now` is injectable for tests.
 */
export function resolveStoredApproval(
  stored: unknown,
  requested: unknown,
  now: number = Date.now(),
): Record<string, unknown> | null {
  const prev =
    stored && typeof stored === "object" ? (stored as Record<string, unknown>) : null;
  const req =
    requested && typeof requested === "object"
      ? (requested as Record<string, unknown>)
      : null;
  if (!req || req.status !== "pending") return prev;
  const reqAt =
    typeof req.submittedAt === "number" && req.submittedAt > 0
      ? Math.min(req.submittedAt, now)
      : null;
  if (!prev) return { status: "pending", submittedAt: reqAt ?? now };
  if (prev.status === "pending") return prev;
  if (prev.status === "approved" || prev.status === "rejected") {
    const prevAt = typeof prev.submittedAt === "number" ? prev.submittedAt : 0;
    if (reqAt !== null && reqAt > prevAt) {
      return { status: "pending", submittedAt: reqAt };
    }
    return prev;
  }
  return prev;
}

/**
 * The hard BYO gate, enforced server-side (docs/manager-hub-plan.md
 * decision #2: "a composed tracker enters `pending` and is not active until
 * approved"). Runs AFTER `resolveStoredApproval` on every write path that
 * stores a spec in `goal_specs` (PUT /goal-specs/:goalId and the migrate
 * import), so a client that simply omits the approval block can no longer
 * put a brand-new COMPOSED tracker live.
 *
 * Which flows are gated — decided per flow:
 *   - GATED  "Build my own" (compose-widget-modal, typed description or an
 *            uploaded plan document): a user-authored COMPOSED tracker. The
 *            client already asks for `pending` + calls submit-approval; the
 *            server now enforces it even when the client doesn't.
 *   - GATED  the analyst's classifier choosing COMPOSED. It reaches the
 *            server through the SAME PUT as a Build-my-own spec with no
 *            verifiable provenance, so the only enforceable rule is "a new
 *            COMPOSED tracker needs approval", whoever shaped it.
 *   - GATED  migrate / import: a restored or uploaded COMPOSED spec with no
 *            stored approval is a new tracker as far as this account is
 *            concerned.
 *   - EXEMPT every non-COMPOSED widget (catalogue widgets are org-defined
 *            measurements, not user-authored shapes).
 *   - EXEMPT an update to a spec that already carries an approval block —
 *            `resolveStoredApproval` owns those transitions (pending stays
 *            pending, decisions are only reopened by a newer resubmit). The
 *            plan editor's non-structural edits land here.
 *   - EXEMPT an existing COMPOSED row stored WITHOUT approval (live before
 *            the gate existed) — grandfathered; re-gating it would silently
 *            take a working tracker offline.
 *   - EXEMPT shared (assigned) goals: `asg_*` ids are refused on these
 *            routes (assertNotAssigned / import skip) and live in
 *            `assigned_goals`, authored by a manager, never in `goal_specs`.
 *
 * Returns the approval to store and whether the server FORCED it (then the
 * caller must route + notify like submit-approval, because the client never
 * will). Pure; `now` injectable.
 */
export function applyComposedGate(args: {
  widget: unknown;
  storedWidget: unknown;
  storedExists: boolean;
  resolved: Record<string, unknown> | null;
  now?: number;
}): { approval: Record<string, unknown> | null; forced: boolean } {
  const { widget, storedWidget, storedExists, resolved } = args;
  if (widget !== "COMPOSED" || resolved) return { approval: resolved, forced: false };
  if (storedExists && storedWidget === "COMPOSED") return { approval: null, forced: false };
  return {
    approval: { status: "pending", submittedAt: args.now ?? Date.now() },
    forced: true,
  };
}
