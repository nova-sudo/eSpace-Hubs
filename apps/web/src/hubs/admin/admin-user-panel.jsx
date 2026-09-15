"use client";

/**
 * The member side panel — A2, with S6 as its third tab.
 *
 * Non-modal on purpose: it sits beside the list rather than over it, so
 * the other rows stay readable while one account is being edited. Auth0
 * navigates to a whole page for this; NN/g argues against both that and
 * the modal, because an admin comparing two people loses the list either
 * way.
 *
 * Field set and guards are carried over verbatim from the old inline
 * editor: display name, status, roles, allowed hubs, primary hub,
 * engagement, manager, Reset two-factor, Wipe dashboard data — plus the
 * two self-protection rules (you cannot drop your own admin role, and
 * you cannot disable your own account) that mirror the server guard so
 * the UI never round-trips just to be told no.
 *
 * Details and Access edit ONE draft and share ONE save, so switching
 * tabs mid-edit never silently discards half of it.
 */

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Field as UiField,
  Input,
  Label,
  SegmentedControl,
  Select,
} from "@/components/ui";
import { HUB_ORDER } from "@espace-devhub/shared/hubs";
import {
  ALL_ENGAGEMENTS,
  ALL_ROLES,
  ALL_STATUSES,
  formatDate,
  formatRelative,
  sameArray,
  statusMeta,
} from "./admin-lib";
import { patchUser, resetTotp, wipeDashboardData } from "./admin-user-actions";
import { MetaRow, StatusBadge, TogglePill } from "./admin-ui";
import { UserActivity } from "./admin-user-activity";

const TABS = [
  { value: "details", label: "Details" },
  { value: "access", label: "Access" },
  { value: "activity", label: "Activity" },
];

export function UserPanel({
  user,
  isSelf,
  allUsers,
  usersById,
  onUpdate,
  onClose,
  confirm,
}) {
  const [tab, setTab] = useState("details");
  const [displayName, setDisplayName] = useState(user.displayName);
  const [roles, setRoles] = useState(user.roles);
  const [status, setStatus] = useState(user.status);
  const [allowedHubs, setAllowedHubs] = useState(user.allowedHubs ?? []);
  const [primaryHub, setPrimaryHub] = useState(user.primaryHub);
  const [engagement, setEngagement] = useState(user.engagement || "espace");
  const [managerId, setManagerId] = useState(user.managerId ?? null);
  const [saving, setSaving] = useState(false);

  // Re-seed from the canonical row whenever it changes — either because
  // a save returned the server's version, or because the admin picked a
  // different person in the list.
  useEffect(() => {
    setDisplayName(user.displayName);
    setRoles(user.roles);
    setStatus(user.status);
    setAllowedHubs(user.allowedHubs ?? []);
    setPrimaryHub(user.primaryHub);
    setEngagement(user.engagement || "espace");
    setManagerId(user.managerId ?? null);
  }, [user]);

  const dirty = useMemo(() => {
    if (displayName !== user.displayName) return true;
    if (!sameArray(roles, user.roles)) return true;
    if (status !== user.status) return true;
    if (!sameArray(allowedHubs, user.allowedHubs ?? [])) return true;
    if (primaryHub !== user.primaryHub) return true;
    if (engagement !== (user.engagement || "espace")) return true;
    if ((managerId ?? null) !== (user.managerId ?? null)) return true;
    return false;
  }, [
    displayName,
    roles,
    status,
    allowedHubs,
    primaryHub,
    engagement,
    managerId,
    user,
  ]);

  function toggleRole(roleId) {
    setRoles((prev) => {
      if (prev.includes(roleId)) {
        // Never strip the last role — the server rejects an empty set,
        // and a roleless user resolves to no hub at all.
        if (prev.length === 1) return prev;
        return prev.filter((r) => r !== roleId);
      }
      return [...prev, roleId];
    });
  }

  function toggleHub(hubId) {
    setAllowedHubs((prev) => {
      const next = prev.includes(hubId)
        ? prev.filter((h) => h !== hubId)
        : [...prev, hubId];
      // Keep primaryHub valid: if the current primary just left the
      // list, fall to the first remaining hub so the admin notices.
      if (!next.includes(primaryHub ?? "")) setPrimaryHub(next[0] ?? null);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    // Only the fields that actually changed — the server no-ops empty
    // patches, but a trimmed body keeps the audit log readable.
    const patch = {};
    if (displayName !== user.displayName) patch.displayName = displayName;
    if (!sameArray(roles, user.roles)) patch.roles = roles;
    if (status !== user.status) patch.status = status;
    if (!sameArray(allowedHubs, user.allowedHubs ?? []))
      patch.allowedHubs = allowedHubs;
    if (primaryHub !== user.primaryHub) patch.primaryHub = primaryHub;
    if (engagement !== (user.engagement || "espace")) patch.engagement = engagement;
    if ((managerId ?? null) !== (user.managerId ?? null))
      patch.managerId = managerId;

    const updated = await patchUser(user, patch);
    setSaving(false);
    if (updated) onUpdate(updated);
  }

  function askResetTotp() {
    confirm({
      title: `Reset two-factor for ${user.displayName}?`,
      body: "Their authenticator app stops working immediately and they are walked through enrolment again at next sign-in. Confirm out-of-band — in person or on a video call — that the request really came from them.",
      confirmLabel: "Reset two-factor",
      onConfirm: async () => {
        setSaving(true);
        const updated = await resetTotp(user);
        setSaving(false);
        if (updated) onUpdate(updated);
      },
    });
  }

  function askWipeData() {
    confirm({
      title: `Wipe all dashboard data for ${user.displayName}?`,
      body: "Deletes their goals, snapshots, AI verdicts and goal specs, context and inputs. The account, its integrations and its sessions are left alone. This cannot be undone.",
      confirmLabel: "Wipe dashboard data",
      onConfirm: async () => {
        setSaving(true);
        await wipeDashboardData(user);
        setSaving(false);
      },
    });
  }

  return (
    <div
      className="rounded-[var(--radius-xl)] bg-card p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
      aria-label={`Editing ${user.displayName}`}
    >
      <div className="flex items-start gap-3">
        <Avatar name={user.displayName} size={40} tone={isSelf ? "sky" : "lav"} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-fg">
            {user.displayName}
            {isSelf ? <span className="text-muted-fg"> (you)</span> : null}
          </div>
          <div className="truncate text-[12px] text-muted-fg">{user.email}</div>
        </div>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Close panel"
            onClick={onClose}
          >
            <X size={15} />
          </Button>
        ) : null}
      </div>

      <div className="mt-4">
        <SegmentedControl
          size="sm"
          onCard
          options={TABS}
          value={tab}
          onChange={setTab}
          className="w-full"
        />
      </div>

      <div className="mt-4">
        {tab === "details" ? (
          <DetailsTab
            user={user}
            isSelf={isSelf}
            saving={saving}
            displayName={displayName}
            setDisplayName={setDisplayName}
            status={status}
            setStatus={setStatus}
            engagement={engagement}
            setEngagement={setEngagement}
            managerId={managerId}
            setManagerId={setManagerId}
            allUsers={allUsers}
          />
        ) : null}

        {tab === "access" ? (
          <AccessTab
            user={user}
            isSelf={isSelf}
            saving={saving}
            roles={roles}
            toggleRole={toggleRole}
            allowedHubs={allowedHubs}
            toggleHub={toggleHub}
            primaryHub={primaryHub}
            setPrimaryHub={setPrimaryHub}
            onResetTotp={askResetTotp}
            onWipeData={askWipeData}
          />
        ) : null}

        {tab === "activity" ? (
          <UserActivity user={user} usersById={usersById} />
        ) : null}
      </div>

      {tab !== "activity" ? (
        <div className="mt-5 border-t border-line pt-4">
          <Button
            type="button"
            variant="ink"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="w-full"
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
          </Button>
          <p className="mt-2 text-[12px] leading-[1.45] text-dim-fg">
            Changes take effect on this member&apos;s next request — they
            don&apos;t need to sign out.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Details ─────────────────────────── */

function DetailsTab({
  user,
  isSelf,
  saving,
  displayName,
  setDisplayName,
  status,
  setStatus,
  engagement,
  setEngagement,
  managerId,
  setManagerId,
  allUsers,
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <UiField label="Display name">
        <Input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={saving}
        />
      </UiField>

      <UiField label="Status">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={saving}
          className="w-full"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s} disabled={isSelf && s === "disabled"}>
              {statusMeta(s).label}
              {isSelf && s === "disabled" ? " (can't disable yourself)" : ""}
            </option>
          ))}
        </Select>
      </UiField>

      {/* Engagement — which client this member belongs to. Decides which
          env-prefixed integration config the API resolves for their data
          fetches (eSpace's Jira vs. Crealogix's). Keep in lockstep with
          the API's ALL_ENGAGEMENTS enum. */}
      <UiField label="Engagement">
        <Select
          value={engagement}
          onChange={(e) => setEngagement(e.target.value)}
          disabled={saving}
          className="w-full"
        >
          {ALL_ENGAGEMENTS.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </Select>
      </UiField>

      {/* Manager assignment (P5). Sets users.managerId — the report edge
          the Manager hub reads. Until Zoho populates it, this is how a
          manager gets a team. */}
      <UiField
        label="Manager"
        hint="Who this member reports to. This is what puts them on a manager's team board."
      >
        <Select
          value={managerId ?? ""}
          onChange={(e) => setManagerId(e.target.value || null)}
          disabled={saving}
          className="w-full"
        >
          <option value="">(no manager)</option>
          {(allUsers ?? [])
            .filter((c) => c.id !== user.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.roles?.includes("manager") ? " · manager" : ""}
              </option>
            ))}
        </Select>
      </UiField>

      {/* Read-only facts below the editable fields — the things an admin
          checks but cannot set from here. */}
      <div className="mt-1">
        <MetaRow label="Saved status" first>
          <StatusBadge status={user.status} />
        </MetaRow>
        <MetaRow label="Two-factor">
          {user.hasTotp ? (
            <Badge tone="mint">Enrolled</Badge>
          ) : (
            <Badge tone="peach">Not enrolled</Badge>
          )}
        </MetaRow>
        <MetaRow label="Password">
          {user.hasPassword ? "Set" : <span className="text-muted-fg">Not set</span>}
        </MetaRow>
        <MetaRow label="Onboarding">
          {user.onboardingCompletedAt ? (
            `Completed ${formatDate(user.onboardingCompletedAt)}`
          ) : (
            <span className="text-muted-fg">Pending</span>
          )}
        </MetaRow>
        <MetaRow label="Last seen">
          {user.lastLoginAt ? (
            `${formatRelative(user.lastLoginAt)} · ${formatDate(user.lastLoginAt)}`
          ) : (
            <span className="text-muted-fg">Never signed in</span>
          )}
        </MetaRow>
        <MetaRow label="Added">{formatDate(user.createdAt)}</MetaRow>
        <MetaRow label="User id">
          <span className="break-all font-mono text-[11.5px]">{user.id}</span>
        </MetaRow>
      </div>
    </div>
  );
}

/* ─────────────────────────── Access ─────────────────────────── */

function AccessTab({
  user,
  isSelf,
  saving,
  roles,
  toggleRole,
  allowedHubs,
  toggleHub,
  primaryHub,
  setPrimaryHub,
  onResetTotp,
  onWipeData,
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label as="div">Roles</Label>
        <p className="mt-1 text-[12px] leading-[1.5] text-muted-fg">
          A member can hold several. Their effective capabilities are the union
          across all of them.
          {isSelf ? " You can't remove your own admin role." : null}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ALL_ROLES.map((r) => {
            const checked = roles.includes(r);
            const disabled =
              saving ||
              (isSelf && r === "admin" && checked) || // self can't drop admin
              (roles.length === 1 && checked); // can't drop the last role
            return (
              <TogglePill
                key={r}
                checked={checked}
                disabled={disabled}
                onClick={() => toggleRole(r)}
                title={
                  isSelf && r === "admin" && checked
                    ? "You can't remove your own admin role."
                    : roles.length === 1 && checked
                      ? "A member needs at least one role."
                      : undefined
                }
              >
                {r}
              </TogglePill>
            );
          })}
        </div>
      </div>

      <div>
        <Label as="div">Allowed hubs</Label>
        <p className="mt-1 text-[12px] leading-[1.5] text-muted-fg">
          Hubs this member can switch into. Hub access is also gated by
          capabilities — granting a hub their roles don&apos;t unlock just hides
          it again server-side.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {HUB_ORDER.map((h) => (
            <TogglePill
              key={h}
              checked={allowedHubs.includes(h)}
              disabled={saving}
              onClick={() => toggleHub(h)}
            >
              {h}
            </TogglePill>
          ))}
        </div>
      </div>

      <UiField label="Primary hub">
        <Select
          value={primaryHub ?? ""}
          onChange={(e) => setPrimaryHub(e.target.value || null)}
          disabled={saving}
          className="w-full"
        >
          <option value="">(not set)</option>
          {allowedHubs.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </Select>
      </UiField>

      <div className="border-t border-line pt-4">
        <Label as="div">Recovery and cleanup</Label>
        <p className="mt-1 text-[12px] leading-[1.5] text-muted-fg">
          Both ask for confirmation first.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {/* Only offered when there is actually an enrolment to clear,
              and never on self — the server refuses that too. */}
          {user.hasTotp && !isSelf ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={onResetTotp}
              disabled={saving}
            >
              Reset two-factor
            </Button>
          ) : null}
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onWipeData}
            disabled={saving}
          >
            Wipe dashboard data
          </Button>
        </div>
      </div>
    </div>
  );
}
