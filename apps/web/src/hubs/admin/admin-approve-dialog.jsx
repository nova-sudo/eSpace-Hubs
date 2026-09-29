"use client";

/**
 * "Approve {name}" (review-ux-flows bug 9). Approving a self-serve signup
 * used to flip `status` alone, so the new member landed with no manager —
 * their packets and tracker approvals then had nobody to go to, although
 * the waiting page promised "an admin will assign you a role and a hub".
 *
 * One dialog asks for everything that decides where their work goes:
 *   - Manager — required, unless the admin explicitly picks "No manager"
 *     (their approvals then go to admins);
 *   - Roles — prefilled from what they signed up with;
 *   - Home hub — where they land after sign-in.
 * One PATCH: { status: "active", managerId, roles?, primaryHub? }.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Field as UiField, Label, Select, useFocusTrap } from "@/components/ui";
import { HUB_ORDER } from "@espace-devhub/shared/hubs";
import { apiGet } from "@/lib/api-client";
import { ALL_ROLES, sameArray } from "./admin-lib";
import { patchUser } from "./admin-user-actions";
import { TogglePill } from "./admin-ui";

const NONE = "__none__";

function hubName(id) {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

/**
 * @param {object} props
 * @param {object} props.user        the pending member
 * @param {Array}  [props.directory] GET /admin/users/directory rows — fetched
 *                                  here when the caller doesn't hold them
 * @param {() => void} props.onClose
 * @param {(updated: object) => void} props.onApproved
 */
export function AdminApproveDialog({ user, directory, onClose, onApproved }) {
  const trapRef = useFocusTrap(true);
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (directory) return undefined;
    let live = true;
    void apiGet("/admin/users/directory").then((r) => {
      if (live && r.ok) setFetched(r.data?.users ?? []);
    });
    return () => {
      live = false;
    };
  }, [directory]);
  const dir = directory ?? fetched;
  // The overview's pending rows carry no roles — read them from the directory.
  const baseRoles = user.roles ?? dir?.find((d) => d.id === user.id)?.roles ?? null;
  const [managerId, setManagerId] = useState(user.managerId ?? "");
  const [rolesEdit, setRolesEdit] = useState(null); // null = untouched
  const roles = rolesEdit ?? (baseRoles?.length ? baseRoles : ["dev"]);
  const hubOptions = user.allowedHubs?.length ? user.allowedHubs : HUB_ORDER;
  const [primaryHub, setPrimaryHub] = useState(user.primaryHub ?? hubOptions[0] ?? "");
  const [busy, setBusy] = useState(false);

  const managers = useMemo(
    () =>
      (dir ?? [])
        .filter((c) => c.id !== user.id && c.status === "active" && c.roles?.includes("manager"))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [dir, user.id],
  );

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

  function toggleRole(r) {
    const prev = roles;
    if (prev.includes(r)) setRolesEdit(prev.length === 1 ? prev : prev.filter((x) => x !== r));
    else setRolesEdit([...prev, r]);
  }

  const missing = !managerId ? "Pick a manager, or choose “No manager”." : null;

  async function approve() {
    if (missing || busy) return;
    setBusy(true);
    const patch = { status: "active", managerId: managerId === NONE ? null : managerId };
    if (rolesEdit && !sameArray(rolesEdit, baseRoles ?? [])) patch.roles = rolesEdit;
    if (primaryHub && primaryHub !== user.primaryHub) patch.primaryHub = primaryHub;
    const updated = await patchUser(user, patch, { silent: true });
    setBusy(false);
    if (!updated) return;
    onApproved(updated);
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
        aria-label={`Approve ${user.displayName}`}
        className="w-[500px] max-w-full rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">
          Approve {user.displayName}
        </h2>
        <p className="mt-2 text-[13px] leading-[1.55] text-muted-fg">
          Decide who they report to and where they land. Their goal approvals and review
          packets go to the manager you pick.
        </p>

        <UiField
          label="Manager"
          className="mt-4"
          hint={managerId === NONE ? "With no manager, their approvals go to admins." : undefined}
        >
          <Select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            disabled={busy}
            className="w-full"
          >
            <option value="">Pick a manager…</option>
            {managers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
            <option value={NONE}>No manager (approvals go to admins)</option>
          </Select>
        </UiField>
        {managers.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-muted-fg">
            No active member holds the manager role yet — grant it to someone first, or
            approve with no manager.
          </p>
        ) : null}

        <div className="mt-4">
          <Label as="div">Roles</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ALL_ROLES.map((r) => (
              <TogglePill
                key={r}
                checked={roles.includes(r)}
                disabled={busy || (roles.length === 1 && roles.includes(r))}
                onClick={() => toggleRole(r)}
              >
                {r}
              </TogglePill>
            ))}
          </div>
        </div>

        <UiField label="Home hub" className="mt-4">
          <Select
            value={primaryHub}
            onChange={(e) => setPrimaryHub(e.target.value)}
            disabled={busy}
            className="w-full"
          >
            {hubOptions.map((h) => (
              <option key={h} value={h}>
                {hubName(h)}
              </option>
            ))}
          </Select>
        </UiField>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {missing ? <span className="mr-auto text-[12px] text-muted-fg">{missing}</span> : null}
          <Button type="button" variant="soft" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ink"
            size="sm"
            disabled={busy || Boolean(missing)}
            onClick={() => void approve()}
          >
            {busy ? "Approving…" : "Approve"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
