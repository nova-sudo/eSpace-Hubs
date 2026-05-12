"use client";

/**
 * Admin Hub — user management. UI on top of:
 *   GET   /api/v1/admin/users         list every member of the org
 *   PATCH /api/v1/admin/users/:id     edit roles/status/hubs/displayName
 *
 * Renders one expandable row per user (mirroring admin-hub-config's
 * shape — same "click row → inline editor" pattern so admins navigate
 * both surfaces with the same muscle memory).
 *
 * The row shows the at-a-glance fields the table needs (email,
 * roles, status, primary hub, last-login). Expanding reveals an
 * inline editor that PATCHes on save; the API is single-endpoint
 * (no per-field PATCH calls) so the editor batches every change
 * into one round-trip.
 *
 * Optimistic UI:
 *   - Save fires → button shows "Saving…"
 *   - Server returns the canonical row → we replace the local copy
 *   - Failure toasts + leaves the row's local edit state intact so
 *     the admin can adjust + retry without re-typing
 *
 * Self-protection: an admin editing their OWN row sees the
 * `admin` checkbox + `status=disabled` option disabled with a hint,
 * mirroring the server-side self-lockout guard. Surfacing the rule
 * locally avoids the round-trip-just-to-be-told-no UX.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiGet, apiPatch } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { HUB_ORDER } from "@espace-devhub/shared/hubs";

// Pulled from db/types.ts ALL_USER_ROLES. Hard-coded here rather than
// imported because the shared package doesn't re-export them yet and
// the list is small + stable.
const ALL_ROLES = ["admin", "dev", "qa", "manager", "hr", "po", "member"];
const ALL_STATUSES = ["invited", "active", "disabled"];

export function AdminUsers() {
  const { user: sessionUser } = useSession();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openUserId, setOpenUserId] = useState(null);

  const canManage = sessionUser?.capabilities?.includes(
    CAPABILITIES.ADMIN_USERS_MANAGE,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/admin/users");
      if (cancelled) return;
      if (!r.ok) {
        toast.error(r.error?.message || "Couldn't load users.");
        setLoading(false);
        return;
      }
      setUsers(r.data?.users ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyUpdate(updatedUser) {
    setUsers((prev) =>
      prev.map((u) => (u.id === updatedUser.id ? updatedUser : u)),
    );
  }

  if (!canManage) {
    return (
      <main className="mx-auto max-w-3xl px-10 py-12">
        <h1 className="mb-3 text-[24px] font-semibold">Not authorised.</h1>
        <p className="text-[13px] text-muted-fg">
          This view requires the {CAPABILITIES.ADMIN_USERS_MANAGE} capability.
          Ask your org admin to extend your roles.
        </p>
      </main>
    );
  }

  return (
    <main className="relative z-[2] mx-auto max-w-5xl px-10 pb-14 pt-10">
      <header className="mb-8">
        <div
          className="mb-2 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          Admin · user management
        </div>
        <h1
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            letterSpacing: "-0.5px",
          }}
        >
          Members of your org.
        </h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-[1.55] text-muted-fg">
          Click a row to edit roles, status, and hub access. Changes
          take effect on the user&apos;s next request — they don&apos;t
          need to log out. Self-edits can&apos;t strip your own admin
          role or disable your own account.
        </p>
      </header>

      {loading ? (
        <div
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          Loading…
        </div>
      ) : users.length === 0 ? (
        <div
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
        >
          No users found for this org.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={sessionUser?.id === u.id}
              expanded={openUserId === u.id}
              onExpand={() =>
                setOpenUserId(openUserId === u.id ? null : u.id)
              }
              onUpdate={applyUpdate}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function UserRow({ user, isSelf, expanded, onExpand, onUpdate }) {
  return (
    <div
      className="rounded-md border bg-card"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-accent-dim/20"
      >
        <div className="flex flex-1 items-baseline gap-3">
          <span
            className="text-[14px] font-semibold"
            style={{ letterSpacing: "-0.2px" }}
          >
            {user.displayName}
          </span>
          <span
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {user.email}
          </span>
          {isSelf ? (
            <span
              className="rounded-full border border-accent px-2 py-0.5 text-accent"
              style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}
            >
              YOU
            </span>
          ) : null}
        </div>
        <StatusPill status={user.status} />
        <span
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
        >
          {user.roles.join(" · ")}
        </span>
        <span
          className="ml-3 text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <UserEditor user={user} isSelf={isSelf} onUpdate={onUpdate} />
      ) : null}
    </div>
  );
}

function UserEditor({ user, isSelf, onUpdate }) {
  // Local edit state — initialised from the canonical user. Saves
  // produce a NEW canonical object via the PATCH response, at which
  // point we lift it up via onUpdate(); the editor stays mounted so
  // the admin can keep editing without re-expanding.
  const [displayName, setDisplayName] = useState(user.displayName);
  const [roles, setRoles] = useState(user.roles);
  const [status, setStatus] = useState(user.status);
  const [allowedHubs, setAllowedHubs] = useState(
    user.allowedHubs.length > 0 ? user.allowedHubs : [],
  );
  const [primaryHub, setPrimaryHub] = useState(user.primaryHub);
  const [saving, setSaving] = useState(false);

  // Re-init when the canonical user updates (after a successful save
  // OR when a sibling row's save triggers an unrelated re-render).
  useEffect(() => {
    setDisplayName(user.displayName);
    setRoles(user.roles);
    setStatus(user.status);
    setAllowedHubs(user.allowedHubs);
    setPrimaryHub(user.primaryHub);
  }, [user]);

  const dirty = useMemo(() => {
    if (displayName !== user.displayName) return true;
    if (!sameArray(roles, user.roles)) return true;
    if (status !== user.status) return true;
    if (!sameArray(allowedHubs, user.allowedHubs)) return true;
    if (primaryHub !== user.primaryHub) return true;
    return false;
  }, [
    displayName,
    roles,
    status,
    allowedHubs,
    primaryHub,
    user.displayName,
    user.roles,
    user.status,
    user.allowedHubs,
    user.primaryHub,
  ]);

  function toggleRole(roleId) {
    setRoles((prev) => {
      const has = prev.includes(roleId);
      if (has) {
        // Disallow removing the last role (UI guard; server also
        // rejects empty roles).
        if (prev.length === 1) return prev;
        return prev.filter((r) => r !== roleId);
      }
      return [...prev, roleId];
    });
  }

  function toggleHub(hubId) {
    setAllowedHubs((prev) => {
      const has = prev.includes(hubId);
      const next = has ? prev.filter((h) => h !== hubId) : [...prev, hubId];
      // Keep primaryHub valid — if we just removed the current
      // primary, drop it to null so the admin notices + re-picks.
      if (!next.includes(primaryHub ?? "")) {
        setPrimaryHub(next[0] ?? null);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    // Build a minimal patch — only fields that actually changed.
    // Server is a no-op on empty patches, but trimming here keeps
    // the audit log cleaner and is friendlier to debug.
    const patch = {};
    if (displayName !== user.displayName) patch.displayName = displayName;
    if (!sameArray(roles, user.roles)) patch.roles = roles;
    if (status !== user.status) patch.status = status;
    if (!sameArray(allowedHubs, user.allowedHubs)) patch.allowedHubs = allowedHubs;
    if (primaryHub !== user.primaryHub) patch.primaryHub = primaryHub;

    const r = await apiPatch(`/admin/users/${user.id}`, patch);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't save user.");
      return;
    }
    onUpdate(r.data?.user);
    toast.success(`Saved ${r.data?.user?.displayName || "user"}.`);
  }

  return (
    <div
      className="border-t px-5 py-5"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="grid grid-cols-2 gap-5">
        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={saving}
            style={inputStyle}
          />
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={saving}
            style={inputStyle}
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s} disabled={isSelf && s === "disabled"}>
                {s}
                {isSelf && s === "disabled" ? " (can't disable yourself)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5">
        <FieldLabel>Roles</FieldLabel>
        <p
          className="mt-1 text-muted-fg"
          style={{ fontSize: 11.5, lineHeight: 1.5 }}
        >
          A user can hold multiple roles. Their effective capabilities
          are the union across all of them. {isSelf ? "You can't remove your own admin role." : null}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ALL_ROLES.map((r) => {
            const checked = roles.includes(r);
            const disabled =
              saving ||
              (isSelf && r === "admin" && checked) || // self can't drop admin
              (roles.length === 1 && checked); // can't drop the last
            return (
              <Pill
                key={r}
                checked={checked}
                disabled={disabled}
                onClick={() => toggleRole(r)}
              >
                {r}
              </Pill>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5">
        <div>
          <FieldLabel>Allowed hubs</FieldLabel>
          <p
            className="mt-1 text-muted-fg"
            style={{ fontSize: 11.5, lineHeight: 1.5 }}
          >
            Hubs this user can switch into. Hub access is also gated
            by capabilities — granting an unsupported hub here just
            hides it server-side at /hubs/me time.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {HUB_ORDER.map((h) => (
              <Pill
                key={h}
                checked={allowedHubs.includes(h)}
                disabled={saving}
                onClick={() => toggleHub(h)}
              >
                {h}
              </Pill>
            ))}
          </div>
        </div>

        <Field label="Primary hub">
          <select
            value={primaryHub ?? ""}
            onChange={(e) => setPrimaryHub(e.target.value || null)}
            disabled={saving}
            style={inputStyle}
          >
            <option value="">(not set)</option>
            {allowedHubs.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <UserMeta user={user} />
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            background: "var(--accent)",
            color: "var(--accent-on, #fff)",
            border: 0,
            borderRadius: "var(--radius-sub, 3px)",
            padding: "9px 16px",
            cursor: saving ? "wait" : dirty ? "pointer" : "default",
            opacity: dirty && !saving ? 1 : 0.5,
          }}
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
        </button>
      </div>
    </div>
  );
}

function UserMeta({ user }) {
  const items = [
    user.lastLoginAt
      ? `last login ${formatDate(user.lastLoginAt)}`
      : "never signed in",
    user.hasTotp ? "TOTP enrolled" : "no TOTP",
    user.hasPassword ? "password set" : "no password",
    user.onboardingCompletedAt ? "onboarded" : "onboarding pending",
  ];
  return (
    <div
      className="text-muted-fg"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.2px",
      }}
    >
      {items.join(" · ")}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

function FieldLabel({ children }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.5px",
        color: "var(--muted-fg)",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function Pill({ checked, disabled, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.3px",
        padding: "4px 10px",
        borderRadius: "var(--radius-sub, 3px)",
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--accent)" : "transparent",
        color: checked ? "var(--accent-on, #fff)" : "var(--muted-fg)",
        border: checked ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }) {
  const color =
    status === "active"
      ? "var(--good, #16a34a)"
      : status === "invited"
        ? "var(--accent)"
        : "var(--bad, #b91c1c)";
  return (
    <span
      className="rounded-full px-2 py-0.5"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9.5,
        letterSpacing: "0.4px",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
      }}
    >
      {status}
    </span>
  );
}

const inputStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 12.5,
  padding: "8px 12px",
  background: "var(--card)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sub, 3px)",
  outline: "none",
};

function sameArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
