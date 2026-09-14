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
import { ArrowRight } from "lucide-react";
import { Badge, Button, Card, Field, Input, Section } from "@/components/ui";
import { apiPatch } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import {
  readLastReviewDate,
  writeLastReviewDate,
  LAST_REVIEW_CHANGE_EVENT,
} from "@/features/date-range";

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
    <div className="flex flex-col gap-8">
      <Section title="Profile">
        <Card className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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

          <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
            <ProfileMeta user={user} />
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Security">
        <Card className="p-6">
          <SecurityRow
            label="Two-factor authentication"
            value={
              user?.totpEnrolled
                ? "Enabled — a 6-digit code is required at every sign-in."
                : "Not enabled — you should never see this row. Contact admin."
            }
            badge={user?.totpEnrolled ? "Enrolled" : "Not enrolled"}
            badgeTone={user?.totpEnrolled ? "mint" : "peach"}
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
                className="inline-flex items-center gap-1 text-[12.5px] font-bold text-fg hover:underline"
              >
                Reset
                <ArrowRight size={13} />
              </a>
            }
          />
        </Card>
      </Section>

      <Section title="Local preferences">
        <Card className="p-6">
          <Field
            label="Last review date"
            hint="Powers the &ldquo;Since review&rdquo; date-range chip on the dashboard. Stored locally — never sent anywhere."
          >
            <Input
              type="date"
              value={lastReview}
              onChange={(e) => writeLastReviewDate(e.target.value)}
            />
          </Field>
        </Card>
      </Section>
    </div>
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
  return <div className="text-[12px] text-muted-fg">{items.join(" · ")}</div>;
}

function SecurityRow({ label, value, badge, badgeTone, action }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div>
        <div className="flex items-center gap-2">
          <div className="text-[14.5px] font-bold text-fg">{label}</div>
          {badge ? <Badge tone={badgeTone}>{badge}</Badge> : null}
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
