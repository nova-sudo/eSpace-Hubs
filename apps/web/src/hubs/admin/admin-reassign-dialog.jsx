"use client";

/**
 * "Reassign all reports from X to Y" (hub-audit §1.4). Used two ways:
 *
 *   - from a manager's row menu, to move a team in one step;
 *   - in place of the plain confirm when an admin DISABLES someone who
 *     still has reports — a disabled manager's queue has no reader, so
 *     the dialog offers to move the team first (or disable anyway).
 *
 *   POST /admin/users/:id/reassign-reports { toManagerId | null }
 *     → { moved, skipped: [{userId, reason}], pendingApprovals, toManagerName }
 *
 * The server refuses an invalid target (inactive, not a manager) and
 * SKIPS any report the move would put in a reporting loop; skipped
 * people are named in the result toast, never dropped silently.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button, Field as UiField, Select, useFocusTrap } from "@/components/ui";
import { patchUser } from "./admin-user-actions";

const NONE = "__none__";

const SKIP_REASONS = {
  would_create_cycle: "moving them would create a reporting loop",
  is_new_manager: "they are the new manager",
};

/** "Skipped A, B — reason. Skipped C — other reason." — each reason for its own people. */
function skippedSummary(skipped, byId) {
  const byReason = new Map();
  for (const s of skipped) {
    const name = byId.get(s.userId)?.displayName ?? s.userId;
    const list = byReason.get(s.reason) ?? [];
    list.push(name);
    byReason.set(s.reason, list);
  }
  return [...byReason.entries()]
    .map(([reason, names]) => `Skipped ${names.join(", ")} — ${SKIP_REASONS[reason] ?? "they couldn't be moved"}.`)
    .join(" ");
}

/**
 * @param {object} props
 * @param {{id:string, displayName:string}} props.manager  whose reports move
 * @param {Array} props.directory   lightweight roster (GET /admin/users/directory)
 * @param {boolean} [props.disabling]  offer "Reassign & disable" / "Disable only"
 * @param {() => void} props.onClose
 * @param {(result: {disabledUser?: object|null}) => void} props.onDone
 */
export function ReassignReportsDialog({ manager, directory, disabling = false, onClose, onDone }) {
  // Focus returns to the opener on unmount via useFocusTrap.
  const trapRef = useFocusTrap(true);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const reports = useMemo(
    () => directory.filter((u) => u.managerId === manager.id),
    [directory, manager.id],
  );
  const activeReports = reports.filter((u) => u.status !== "disabled");
  const candidates = useMemo(
    () =>
      directory
        .filter(
          (u) =>
            u.id !== manager.id &&
            u.status === "active" &&
            u.roles?.includes("manager"),
        )
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [directory, manager.id],
  );
  const byId = useMemo(() => new Map(directory.map((u) => [u.id, u])), [directory]);

  // Escape closes (not mid-request). The parent passes an inline onClose,
  // so read it (and busy) through refs and bind the listener once.
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busyRef.current) closeRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function reassign() {
    const toManagerId = target === NONE ? null : target;
    const r = await apiPost(`/admin/users/${manager.id}/reassign-reports`, { toManagerId });
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't reassign the reports.");
      return false;
    }
    const { moved = 0, skipped = [], pendingApprovals = 0, toManagerName } = r.data ?? {};
    const dest = toManagerName || "no manager";
    toast.success(
      `Moved ${moved} report${moved === 1 ? "" : "s"} to ${dest}.` +
        (pendingApprovals ? ` ${pendingApprovals} pending approval${pendingApprovals === 1 ? "" : "s"} went with them.` : ""),
      skipped.length ? { description: skippedSummary(skipped, byId) } : undefined,
    );
    return true;
  }

  async function run({ andDisable }) {
    setBusy(true);
    let ok = true;
    if (target) ok = await reassign();
    let disabledUser = null;
    if (ok && andDisable) {
      disabledUser = await patchUser(manager, { status: "disabled" });
      ok = Boolean(disabledUser);
    }
    setBusy(false);
    if (ok) onDone({ disabledUser });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={disabling ? `Disable ${manager.displayName}` : `Reassign ${manager.displayName}'s reports`}
        className="w-[480px] max-w-full rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">
          {disabling ? `Disable ${manager.displayName}?` : `Reassign ${manager.displayName}'s reports`}
        </h2>
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-fg">
          {disabling
            ? `They manage ${activeReports.length} active ${activeReports.length === 1 ? "person" : "people"}. A disabled manager can't approve or grade, so move the team first — or disable anyway and their approvals go to admins.`
            : `${reports.length} ${reports.length === 1 ? "person reports" : "people report"} to ${manager.displayName}. Everyone moves in one step, pending approvals included.`}
        </p>

        {reports.length > 0 ? (
          <UiField label="Move the team to" className="mt-4">
            <Select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={busy}
              className="w-full"
            >
              <option value="">{disabling ? "Don't reassign" : "Pick a manager…"}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
              <option value={NONE}>No manager (approvals go to admins)</option>
            </Select>
          </UiField>
        ) : null}
        {candidates.length === 0 && reports.length > 0 ? (
          <p className="mt-2 text-[12px] text-muted-fg">
            No other active member holds the manager role yet — grant it to someone first.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="soft" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {disabling ? (
            <>
              {target ? null : (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run({ andDisable: true })}
                >
                  Disable only
                </Button>
              )}
              {target ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run({ andDisable: true })}
                >
                  {busy ? "Working…" : "Reassign & disable"}
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              type="button"
              variant="ink"
              size="sm"
              disabled={busy || !target || reports.length === 0}
              onClick={() => void run({ andDisable: false })}
            >
              {busy ? "Moving…" : "Reassign"}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
