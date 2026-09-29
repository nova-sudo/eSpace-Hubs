"use client";

/**
 * Landing surface for self-sign-up users whose account is still
 * `status="pending_admin"`. AuthGuard routes them here after they've
 * finished TOTP setup + onboarding. Stays here until an admin promotes
 * their status to `active` and grants them a role/hub.
 *
 * The page polls /me every 30s (silently — no loading flip, so the
 * card doesn't flash) and leaves on its own the moment the status
 * changes. "Check again" does the same on demand.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { AuthCard } from "./auth-card.jsx";
import { useSession } from "./use-session.js";

const POLL_MS = 30_000;

const STATUS_LABELS = {
  pending_admin: "Waiting for an admin to approve",
  invited: "Invited — password not set yet",
  active: "Active",
  disabled: "Disabled",
};

export function WaitingApproval() {
  const router = useRouter();
  const { user, logout, refreshSilent } = useSession();
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);

  const pending = user?.status === "pending_admin";

  // Approved (or otherwise no longer pending) → leave. AuthGuard only
  // ever routes INTO this page, so the way out has to live here.
  useEffect(() => {
    if (user && !pending) router.replace("/");
  }, [user, pending, router]);

  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(() => {
      void refreshSilent().then(() => setLastChecked(new Date()));
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pending, refreshSilent]);

  async function checkAgain() {
    setChecking(true);
    await refreshSilent();
    setLastChecked(new Date());
    setChecking(false);
  }

  return (
    <AuthCard
      title="Pending approval"
      lead={`Thanks${user?.displayName ? `, ${user.displayName}` : ""} — your account is set up. An admin of your organisation now needs to assign you a role and a hub before you can start tracking. Most requests are approved within a working day; this page checks on its own and moves you on as soon as it happens.`}
    >
      <Card tone="lemon" radius="lg" padding={14} className="flex items-start gap-3">
        <Clock size={18} className="mt-0.5 shrink-0" />
        <div className="text-[13px] leading-[1.6]">
          <div>Email · {user?.email || "—"}</div>
          <div>Status · {STATUS_LABELS[user?.status] ?? user?.status ?? "—"}</div>
          {user?.department ? <div>Department · {user.department}</div> : null}
          {lastChecked ? (
            <div className="text-muted-fg">
              Last checked ·{" "}
              {lastChecked.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          ) : null}
        </div>
      </Card>

      <p className="mt-4 text-[12.5px] leading-[1.5] text-muted-fg">
        Been longer than a day? Message your admin and mention the email
        above — they approve signups from the admin hub.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="soft" size="sm" onClick={checkAgain} disabled={checking}>
          {checking ? "Checking…" : "Check again"}
        </Button>
        <button
          type="button"
          onClick={() => logout()}
          className="text-[13px] font-bold text-fg"
        >
          Sign out
        </button>
      </div>
    </AuthCard>
  );
}
