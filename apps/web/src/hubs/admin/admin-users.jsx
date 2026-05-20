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
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
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
  const [inviteOpen, setInviteOpen] = useState(false);

  const canManage = sessionUser?.capabilities?.includes(
    CAPABILITIES.ADMIN_USERS_MANAGE,
  );

  async function reloadUsers() {
    const r = await apiGet("/admin/users");
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't load users.");
      return;
    }
    setUsers(r.data?.users ?? []);
  }

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

  function handleInviteSuccess() {
    setInviteOpen(false);
    void reloadUsers();
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
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
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
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          style={primaryButtonStyle}
        >
          + Invite user
        </button>
      </header>

      {inviteOpen ? (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onSuccess={handleInviteSuccess}
        />
      ) : null}

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
  const [engagement, setEngagement] = useState(user.engagement || "espace");
  const [saving, setSaving] = useState(false);

  // Re-init when the canonical user updates (after a successful save
  // OR when a sibling row's save triggers an unrelated re-render).
  useEffect(() => {
    setDisplayName(user.displayName);
    setRoles(user.roles);
    setStatus(user.status);
    setAllowedHubs(user.allowedHubs);
    setPrimaryHub(user.primaryHub);
    setEngagement(user.engagement || "espace");
  }, [user]);

  const dirty = useMemo(() => {
    if (displayName !== user.displayName) return true;
    if (!sameArray(roles, user.roles)) return true;
    if (status !== user.status) return true;
    if (!sameArray(allowedHubs, user.allowedHubs)) return true;
    if (primaryHub !== user.primaryHub) return true;
    if (engagement !== (user.engagement || "espace")) return true;
    return false;
  }, [
    displayName,
    roles,
    status,
    allowedHubs,
    primaryHub,
    engagement,
    user.displayName,
    user.roles,
    user.status,
    user.allowedHubs,
    user.primaryHub,
    user.engagement,
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
    if (engagement !== (user.engagement || "espace")) patch.engagement = engagement;

    const r = await apiPatch(`/admin/users/${user.id}`, patch);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't save user.");
      return;
    }
    onUpdate(r.data?.user);
    toast.success(`Saved ${r.data?.user?.displayName || "user"}.`);
  }

  // Admin-side TOTP reset. Only relevant when the target user has
  // TOTP enrolled (otherwise the operation is a no-op and the button
  // is hidden). Forbidden on self — the server rejects too, but we
  // hide the button to make that clear without round-tripping.
  async function handleResetTotp() {
    if (
      !window.confirm(
        `Reset TOTP for ${user.displayName}?\n\nTheir authenticator app will stop working. On their next sign-in they'll be walked through enrolment again. Confirm out-of-band (in person, video call) that this is really them.`,
      )
    ) {
      return;
    }
    setSaving(true);
    const r = await apiPost(`/admin/users/${user.id}/totp/reset`, {});
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't reset TOTP.");
      return;
    }
    onUpdate(r.data?.user);
    if (r.data?.reset === false) {
      toast.info(`${user.displayName} already had no TOTP enrolled.`);
    } else {
      toast.success(`TOTP reset for ${user.displayName}.`);
    }
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

        {/* Engagement — which client/project this user belongs to.
            Drives which env-prefixed integration config the API
            resolves for their data fetches (eSpace's Jira vs.
            Crealogix's Jira, etc.). Add a new value here in lockstep
            with the API's ALL_ENGAGEMENTS enum. */}
        <Field label="Engagement">
          <select
            value={engagement}
            onChange={(e) => setEngagement(e.target.value)}
            disabled={saving}
            style={inputStyle}
          >
            <option value="espace">eSpace</option>
            <option value="crealogix">Crealogix</option>
          </select>
        </Field>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <UserMeta user={user} />
        <div className="flex items-center gap-2">
          {/* Reset-TOTP — only shown when the user actually has TOTP
              enrolled (no point offering a no-op) and never on self
              (server-side guarded too). */}
          {user.hasTotp && !isSelf ? (
            <button
              type="button"
              onClick={handleResetTotp}
              disabled={saving}
              style={{
                ...dangerButtonStyle,
                opacity: saving ? 0.55 : 1,
                cursor: saving ? "wait" : "pointer",
              }}
              title="Clears the user's TOTP secret. They'll re-enrol on next sign-in."
            >
              Reset TOTP
            </button>
          ) : null}
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

const primaryButtonStyle = {
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
  cursor: "pointer",
};

const ghostButtonStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  background: "transparent",
  color: "var(--fg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sub, 3px)",
  padding: "9px 16px",
  cursor: "pointer",
};

const dangerButtonStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  background: "transparent",
  color: "var(--bad, #b91c1c)",
  border: "1px solid var(--bad, #b91c1c)",
  borderRadius: "var(--radius-sub, 3px)",
  padding: "7px 12px",
  cursor: "pointer",
};

/**
 * Invite-user dialog. Lightweight modal — backdrop blocks pointer
 * events on the underlying list so an accidental click outside the
 * dialog is treated as "cancel". Form posts to /api/v1/auth/invite
 * (the same endpoint admin-invite-from-CLI uses; admin-side UI just
 * wires a friendlier surface to it).
 *
 * Server enforces:
 *   - email uniqueness within the org (409 user_already_active if
 *     the address already maps to an active/disabled user; re-invites
 *     of `invited`-status users are allowed and re-mint the token)
 *   - admin role on the caller (guarded by the route's requireRole)
 *
 * The form mirrors the inviteSchema on the server: email + displayName
 * required, multi-select roles, defaults to one role checked ("dev")
 * because every invitee needs at least one role.
 */
function InviteDialog({ onClose, onSuccess }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roles, setRoles] = useState(["dev"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function toggleRole(roleId) {
    setRoles((prev) => {
      const has = prev.includes(roleId);
      if (has) {
        if (prev.length === 1) return prev; // can't drop the last
        return prev.filter((r) => r !== roleId);
      }
      return [...prev, roleId];
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !displayName.trim() || roles.length === 0) {
      setError("Email, name, and at least one role are required.");
      return;
    }
    setSubmitting(true);
    // The inviteSchema accepts both legacy `role` + new `roles`. Send
    // both: server keeps `role` (= roles[0]) in lockstep until the
    // singular column is removed.
    const r = await apiPost("/auth/invite", {
      email: email.trim().toLowerCase(),
      role: roles[0],
      roles,
      displayName: displayName.trim(),
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(humaniseInviteError(r.error));
      return;
    }
    toast.success(`Invite sent to ${email.trim().toLowerCase()}.`);
    onSuccess();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => {
        // Click outside the inner card → close. Don't close when the
        // form itself bubbles a click up to the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="rounded-md border bg-card p-6"
        style={{
          borderColor: "var(--border-strong)",
          width: 460,
          maxWidth: "92vw",
        }}
      >
        <div
          className="mb-4 uppercase tracking-[0.5px] text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          Invite new user
        </div>
        <h2
          className="mb-4 font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 20,
            letterSpacing: "-0.4px",
          }}
        >
          They&apos;ll get an email with a one-time setup link.
        </h2>

        <div className="flex flex-col gap-4">
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoFocus
              required
              placeholder="name@example.com"
              style={inputStyle}
            />
          </Field>
          <Field label="Display name">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              required
              placeholder="Full name as they should appear"
              style={inputStyle}
            />
          </Field>
          <div>
            <FieldLabel>Roles</FieldLabel>
            <p
              className="mt-1 text-muted-fg"
              style={{ fontSize: 11.5, lineHeight: 1.5 }}
            >
              They can hold multiple. Capabilities are the union across
              roles. Adjust later from the row editor.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ALL_ROLES.map((r) => {
                const checked = roles.includes(r);
                const disabled =
                  submitting || (roles.length === 1 && checked);
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
        </div>

        {error ? (
          <div
            className="mt-4"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--bad)",
            }}
          >
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={ghostButtonStyle}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{
              ...primaryButtonStyle,
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}

function humaniseInviteError(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "user_already_active")
    return "An active or disabled user with that email already exists. Edit them from the list instead.";
  if (err.code === "validation_error")
    return err.message || "Check the fields and try again.";
  if (err.code === "rate_limited")
    return "Too many invites from this network. Wait a moment and retry.";
  if (err.code === "network_error")
    return "Couldn't reach the server. Check your connection and try again.";
  return err.message || "Something went wrong. Try again.";
}

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
