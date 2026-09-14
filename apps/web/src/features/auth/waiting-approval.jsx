"use client";

/**
 * Landing surface for self-sign-up users whose account is still
 * `status="pending_admin"`. AuthGuard routes them here after they've
 * finished TOTP setup + onboarding. Stays here until admin promotes
 * their status to `active` and grants them a role/hub.
 */

import { Clock } from "lucide-react";
import { Card } from "@/components/ui";
import { AuthCard } from "./auth-card.jsx";
import { useSession } from "./use-session.js";

export function WaitingApproval() {
  const { user, logout } = useSession();

  return (
    <AuthCard
      title="Pending approval"
      lead={`Thanks${user?.displayName ? `, ${user.displayName}` : ""} — your account is set up. An admin needs to assign you a role and hub before you can start tracking.`}
    >
      <Card tone="lemon" radius="lg" padding={14} className="flex items-start gap-3">
        <Clock size={18} className="mt-0.5 shrink-0" />
        <div className="text-[13px] leading-[1.6]">
          <div>Email · {user?.email || "—"}</div>
          <div>Status · pending admin approval</div>
          {user?.department ? <div>Department · {user.department}</div> : null}
        </div>
      </Card>

      <div className="mt-6 text-center">
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
