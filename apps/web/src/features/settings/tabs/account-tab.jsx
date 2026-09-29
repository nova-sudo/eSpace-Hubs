"use client";

/**
 * Settings → Account tab. Self-service profile editor + auth-state
 * surface. Wires:
 *
 *   PATCH /api/v1/auth/me           displayName / employeeId /
 *                                    department (partial, no-op-safe)
 *   PATCH /api/v1/auth/me {prefs}   AI provider + last review date
 *                                    (via the prefs store — synced to
 *                                    the account, not this browser)
 *
 * Email is read-only here. Changing it would invalidate the login
 * binding + every active session and needs a confirmation-email
 * dance we haven't built yet. Surfaced as muted text with a hint.
 *
 * Two-factor: the user sees how many backup codes are left, can
 * generate a fresh set (RegenerateBackupCodesDialog — needs a current
 * authenticator code) and can MOVE two-factor to a new phone without an
 * admin (MoveTwoFactorDialog — password + old code or a backup code).
 * `?action=move-2fa` opens that dialog on arrival; the post-sign-in
 * "Set up your new phone now" offer links here with it.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Badge, Button, Card, Field, Input, Section, Select } from "@/components/ui";
import { apiPatch } from "@/lib/api-client";
import {
  MOVE_2FA_ACTION,
  MoveTwoFactorDialog,
  RegenerateBackupCodesDialog,
  useSession,
} from "@/features/auth";
import { AI_PROVIDERS, useAiProvider } from "@/features/analyst";
import {
  readLastReviewDate,
  writeLastReviewDate,
  LAST_REVIEW_CHANGE_EVENT,
} from "@/features/date-range";
import { HUBS } from "@espace-devhub/shared/hubs";

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

const STATUS_LABELS = {
  active: "Active",
  pending_admin: "Waiting for admin approval",
  invited: "Invited",
  disabled: "Disabled",
};

const ROLE_LABELS = {
  admin: "Admin",
  dev: "Developer",
  qa: "QA",
  manager: "Manager",
  hr: "HR",
  po: "Product owner",
  member: "Member",
};

export function AccountTab() {
  const { user, refreshSilent } = useSession();
  const { provider: aiProvider, setProvider: setAiProvider } = useAiProvider();
  const [displayName, setDisplayName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const backupLeft = user?.backupCodesRemaining ?? 0;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const action = searchParams.get("action");

  // `?action=move-2fa` (the post-sign-in offer) opens the move dialog
  // once, then drops the param so a refresh or Back doesn't reopen it.
  useEffect(() => {
    if (action !== MOVE_2FA_ACTION || !user?.totpEnrolled) return;
    setMoveOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("action");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [action, user?.totpEnrolled, searchParams, pathname, router]);

  // Hydrate the form from the canonical user once /me resolves, and
  // re-hydrate when the profile itself changes (e.g. an admin edited it).
  // Keyed on the three fields, not the `user` object — a silent session
  // refresh (2FA regenerate / move) makes a new object with the same
  // profile. And a field is only replaced while it still shows the value
  // last seeded into it, so unsaved edits survive any refresh.
  const seededRef = useRef(null);
  const userDisplayName = user ? (user.displayName ?? "") : null;
  const userEmployeeId = user ? (user.employeeId ?? "") : null;
  const userDepartment = user ? (user.department ?? "") : null;
  useEffect(() => {
    if (userDisplayName === null) return;
    const prev = seededRef.current;
    const next = { displayName: userDisplayName, employeeId: userEmployeeId, department: userDepartment };
    seededRef.current = next;
    const reseed = (field) => (cur) => (!prev || cur === prev[field] ? next[field] : cur);
    setDisplayName(reseed("displayName"));
    setEmployeeId(reseed("employeeId"));
    setDepartment(reseed("department"));
  }, [userDisplayName, userEmployeeId, userDepartment]);

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
    if (!displayName.trim()) {
      toast.error("Display name can't be empty.");
      return;
    }
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
    // etc.) see the new fields — silently, so AuthGuard doesn't swap
    // this page for "Authenticating…" while /me is in flight.
    await refreshSilent();
    toast.success("Profile updated.");
  }

  return (
    <div className="flex flex-col gap-8">
      <Section title="Profile">
        <Card className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Display name" hint="Shown in the header and to your manager.">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                disabled={saving}
                required
              />
            </Field>
            <Field
              label="Email"
              hint="This is your sign-in. To change it, ask your admin."
            >
              <Input
                value={user?.email ?? ""}
                readOnly
                style={{ opacity: 0.7, cursor: "default" }}
              />
            </Field>
            <Field
              label="Employee ID"
              hint="Optional. Whatever your HR system calls it."
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
              hint="For your org chart. Which hubs you can use is assigned by your admin, not by this field."
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
              user?.totpEnrolled ? (
                <>
                  Enabled — a 6-digit code from your authenticator app is
                  required at every sign-in.{" "}
                  <span className={backupLeft <= 2 ? "font-bold text-fg" : undefined}>
                    {backupLeft === 1
                      ? "1 backup code left."
                      : `${backupLeft} backup codes left.`}
                  </span>{" "}
                  New or lost phone? Use &ldquo;Move to a new phone&rdquo; —
                  confirm with your password and a code from the old phone or
                  a backup code. Only if you have neither does an admin need
                  to reset two-factor for you.
                </>
              ) : (
                "Not set up yet — you'll be asked to enrol the next time you open the app."
              )
            }
            badge={user?.totpEnrolled ? "Enrolled" : "Not enrolled"}
            badgeTone={user?.totpEnrolled ? "mint" : "peach"}
            action={
              user?.totpEnrolled ? (
                <div className="flex flex-col items-stretch gap-2 sm:items-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="soft"
                    onClick={() => setMoveOpen(true)}
                  >
                    Move to a new phone
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="soft"
                    onClick={() => setRegenOpen(true)}
                  >
                    Generate new codes
                  </Button>
                </div>
              ) : null
            }
          />
          <RegenerateBackupCodesDialog
            open={regenOpen}
            onClose={() => setRegenOpen(false)}
            email={user?.email}
            onRegenerated={() => void refreshSilent()}
          />
          <MoveTwoFactorDialog
            open={moveOpen}
            onClose={() => setMoveOpen(false)}
            email={user?.email}
            onMoved={() => void refreshSilent()}
          />
          <SecurityRow
            label="Password"
            value={
              <>
                {user?.lastLoginAt
                  ? `Last sign-in: ${formatRelative(user.lastLoginAt)}. `
                  : "No password sign-in recorded yet. "}
                Resetting sends a link to your email; setting a new password
                signs you out of every device, including this one.
              </>
            }
            action={
              <a
                href="/forgot-password"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[12.5px] font-bold text-fg hover:underline"
              >
                Reset password
                <ArrowRight size={13} />
              </a>
            }
          />
        </Card>
      </Section>

      <Section title="Preferences">
        <Card className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field
              label="AI provider"
              hint="Which model answers the AI features (goal classification, PR grading, chat). Text you type into those surfaces is sent to this provider — see Integrations → What the AI sees."
            >
              <Select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                aria-label="AI provider"
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Last review date"
              hint="Powers the “Since review” date range. Saved to your account, so it follows you across devices."
            >
              <Input
                type="date"
                value={lastReview}
                onChange={(e) => writeLastReviewDate(e.target.value)}
              />
            </Field>
          </div>
        </Card>
      </Section>
    </div>
  );
}

function ProfileMeta({ user }) {
  if (!user) return <span />;
  const roles = (user.roles?.length ? user.roles : [user.role]).filter(Boolean);
  const items = [
    roles.length
      ? `${roles.length === 1 ? "Role" : "Roles"}: ${roles
          .map((r) => ROLE_LABELS[r] ?? r)
          .join(" · ")}`
      : null,
    `Status: ${STATUS_LABELS[user.status] ?? user.status}`,
    user.primaryHub ? `Home hub: ${HUBS[user.primaryHub]?.label ?? user.primaryHub}` : null,
    user.onboardingCompletedAt ? null : "Setup not finished",
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
