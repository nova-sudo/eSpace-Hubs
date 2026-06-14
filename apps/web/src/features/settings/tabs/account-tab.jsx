"use client";

/**
 * Settings → Account tab. Self-service profile editor + auth-state
 * surface. Wires:
 *
 *   PATCH /api/v1/auth/me           displayName / employeeId /
 *                                    department (partial, no-op-safe)
 *   POST  /api/v1/auth/totp/disable code-confirmed 2FA disable
 *                                    (UI shows status + entry point;
 *                                    actual disable flow not in this
 *                                    tab to keep scope tight)
 *
 * Email is read-only here. Changing it would invalidate the login
 * binding + every active session and needs a confirmation-email
 * dance we haven't built yet. Surfaced as muted text with a hint.
 *
 * `Last review date` stays — it's a local-only date powering the
 * "Since review" date-range chip on the dashboard and predates the
 * server-side user doc. Kept on the same tab so the user has one
 * "this is me" surface.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Card, Field, Input, Section } from "@/components/ui";
import { apiPatch } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import {
  readLastReviewDate,
  writeLastReviewDate,
  LAST_REVIEW_CHANGE_EVENT,
} from "@/features/dashboard";

function subscribeReviewDate(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(LAST_REVIEW_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(LAST_REVIEW_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function AccountTab() {
  const { user, refresh } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [saving, setSaving] = useState(false);

  // Hydrate the form from the canonical user once /me resolves. Also
  // re-hydrate when the session refreshes (e.g. an admin updated this
  // user's profile from /admin/users — useful so the UI doesn't show
  // stale fields the user sees in the chip).
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? "");
    setEmployeeId(user.employeeId ?? "");
    setDepartment(user.department ?? "");
  }, [user]);

  const lastReview = useSyncExternalStore(
    subscribeReviewDate,
    () => readLastReviewDate(),
    () => "",
  );

  const dirty =
    !!user &&
    (displayName !== (user.displayName ?? "") ||
      employeeId !== (user.employeeId ?? "") ||
      department !== (user.department ?? ""));

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    // Build a minimal patch — same shape the server's no-op detector
    // expects. Untouched fields stay undefined so the server doesn't
    // see them in the keyset.
    const patch = {};
    if (displayName !== (user.displayName ?? "")) {
      patch.displayName = displayName.trim();
    }
    if (employeeId !== (user.employeeId ?? "")) {
      // Empty string → null (clears the field). Otherwise trim + send.
      patch.employeeId = employeeId.trim() === "" ? null : employeeId.trim();
    }
    if (department !== (user.department ?? "")) {
      patch.department = department.trim() === "" ? null : department.trim();
    }

    const r = await apiPatch("/auth/me", patch);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't save profile.");
      return;
    }
    // Refresh useSession so other components (header chip, AuthGuard,
    // etc.) see the new displayName / employeeId / department.
    await refresh();
    toast.success("Profile updated.");
  }

  return (
    <>
      <Section num="01 /" title="Profile">
        <Card className="p-6">
          <div className="grid grid-cols-2 gap-5">
            <Field label="Display name">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                disabled={saving}
              />
            </Field>
            <Field
              label="Email"
              hint="Email changes need an out-of-band confirmation. Ask an admin to update the address on your row from /admin/users."
            >
              <Input
                value={user?.email ?? ""}
                readOnly
                mono
                style={{ opacity: 0.7, cursor: "default" }}
              />
            </Field>
            <Field
              label="Employee ID"
              hint="Optional. Used by future Zoho/HR syncs; the dashboard's filters can reference it."
            >
              <Input
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="e.g. EMP-0421"
                disabled={saving}
                mono
              />
            </Field>
            <Field
              label="Department"
              hint="Free-form label. Drives hub auto-assignment for new invitees only — your hubs are managed by admin from /admin/users."
            >
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Payments Platform"
                disabled={saving}
              />
            </Field>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <ProfileMeta user={user} />
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
                opacity: dirty && !saving ? 1 : 0.55,
              }}
            >
              {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
            </button>
          </div>
        </Card>
      </Section>

      <Section num="02 /" title="Security">
        <Card className="p-6">
          <SecurityRow
            label="Two-factor authentication"
            value={
              user?.totpEnrolled
                ? "Enabled — a 6-digit code is required at every sign-in."
                : "Not enabled — you should never see this row. Contact admin."
            }
            badge={user?.totpEnrolled ? "Enrolled" : "Not enrolled"}
            badgeColor={user?.totpEnrolled ? "var(--good, #16a34a)" : "var(--bad)"}
          />
          <SecurityRow
            label="Password"
            value={
              user?.lastLoginAt
                ? `Last successful sign-in: ${formatRelative(user.lastLoginAt)}.`
                : "Never signed in via password yet."
            }
            action={
              <a
                href="/forgot-password"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Reset →
              </a>
            }
          />
        </Card>
      </Section>

      <Section num="03 /" title="Local preferences">
        <Card className="p-6">
          <Field
            label="Last review date"
            hint="Powers the &ldquo;Since review&rdquo; date-range chip on the dashboard. Stored locally — never sent anywhere."
          >
            <Input
              type="date"
              value={lastReview}
              onChange={(e) => writeLastReviewDate(e.target.value)}
              mono
            />
          </Field>
        </Card>
      </Section>
    </>
  );
}

function ProfileMeta({ user }) {
  if (!user) return <span />;
  const items = [
    user.roles?.length
      ? `roles: ${user.roles.join(" · ")}`
      : `role: ${user.role}`,
    `status: ${user.status}`,
    user.primaryHub ? `primary hub: ${user.primaryHub}` : null,
    user.onboardingCompletedAt ? "onboarded" : "onboarding pending",
  ].filter(Boolean);
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

function SecurityRow({ label, value, badge, badgeColor, action }) {
  return (
    <div
      className="flex items-start justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
      style={{ borderStyle: "dashed" }}
    >
      <div>
        <div className="flex items-center gap-2">
          <div
            className="font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 14,
            }}
          >
            {label}
          </div>
          {badge ? (
            <span
              className="rounded-full px-2 py-0.5"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9.5,
                letterSpacing: "0.4px",
                textTransform: "uppercase",
                color: badgeColor,
                border: `1px solid ${badgeColor}`,
              }}
            >
              {badge}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[12.5px] leading-[1.5] text-muted-fg">
          {value}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function formatRelative(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "today";
  if (diffMs < 2 * day) return "yesterday";
  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
