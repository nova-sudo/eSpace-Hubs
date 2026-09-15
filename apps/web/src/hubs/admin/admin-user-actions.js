"use client";

/**
 * The mutations an admin can run against one account, in one place so
 * the table's overflow menu, the bulk bar and the side panel all fire
 * exactly the same request and the same toast.
 *
 * Each returns the canonical user row on success and null on failure,
 * having already toasted. Callers lift the returned row into their
 * local list.
 *
 * The confirmations live with the callers, not here — every one of
 * these is destructive enough to be guarded, but the wording differs
 * between "this account" and "these 4 accounts".
 */

import { toast } from "sonner";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";

/** PATCH /admin/users/:id — partial; the server no-ops an empty patch. */
export async function patchUser(user, patch, { silent = false } = {}) {
  const r = await apiPatch(`/admin/users/${user.id}`, patch);
  if (!r.ok) {
    toast.error(r.error?.message || `Couldn't save ${user.displayName}.`);
    return null;
  }
  if (!silent) toast.success(`Saved ${r.data?.user?.displayName || "user"}.`);
  return r.data?.user ?? null;
}

/**
 * Clears the user's TOTP secret so they re-enrol at next sign-in. The
 * server refuses this on self; callers hide the action there too.
 */
export async function resetTotp(user, { silent = false } = {}) {
  const r = await apiPost(`/admin/users/${user.id}/totp/reset`, {});
  if (!r.ok) {
    toast.error(r.error?.message || "Couldn't reset two-factor.");
    return null;
  }
  if (!silent) {
    if (r.data?.reset === false) {
      toast.info(`${user.displayName} already had no authenticator enrolled.`);
    } else {
      toast.success(`Two-factor reset for ${user.displayName}.`);
    }
  }
  return r.data?.user ?? null;
}

/**
 * Wipes the user's goals / snapshots / verdicts / specs / context /
 * inputs. Leaves the account, its integrations and its sessions alone.
 * Useful for clearing data the pre-#117 localStorage-mirror bug wrote
 * under the wrong account.
 */
export async function wipeDashboardData(user) {
  const r = await apiDelete(`/admin/users/${user.id}/personal-data`);
  if (!r.ok) {
    toast.error(r.error?.message || "Couldn't reset personal data.");
    return false;
  }
  const d = r.data?.deleted || {};
  const total =
    (d.goals || 0) +
    (d.snapshots || 0) +
    (d.gradingVerdicts || 0) +
    (d.goalSpecs || 0) +
    (d.goalContext || 0) +
    (d.goalInputs || 0);
  if (total === 0) {
    toast.info(`${user.displayName} had nothing to clean up.`);
  } else {
    toast.success(
      `Wiped ${total} row${total === 1 ? "" : "s"} for ${user.displayName} ` +
        `(goals:${d.goals || 0} · snapshots:${d.snapshots || 0} · verdicts:${
          d.gradingVerdicts || 0
        } · specs:${d.goalSpecs || 0} · context:${d.goalContext || 0} · inputs:${
          d.goalInputs || 0
        }).`,
    );
  }
  return true;
}
