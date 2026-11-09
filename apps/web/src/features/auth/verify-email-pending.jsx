"use client";

/**
 * "Check your inbox" — where AuthGuard parks a self-signup whose email
 * is not verified yet (status `pending_email`).
 *
 * The link is often opened on another device (phone mail app), so the
 * page polls /me silently and moves on by itself the moment the
 * account turns active. "Resend link" is rate-limited server-side
 * (1/min, 5/hour); the button mirrors the minute with a cooldown.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button, Card } from "@/components/ui";
import { AuthCard } from "./auth-card.jsx";
import { useSession } from "./use-session.js";

const POLL_MS = 15_000;
const RESEND_COOLDOWN_S = 60;

export function VerifyEmailPending() {
  const router = useRouter();
  const { user, logout, refreshSilent } = useSession();
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const pending = user?.status === "pending_email";

  // Verified (possibly on another device) → continue the setup chain.
  useEffect(() => {
    if (user && !pending) router.replace("/");
  }, [user, pending, router]);

  useEffect(() => {
    if (!pending) return undefined;
    const id = setInterval(() => void refreshSilent(), POLL_MS);
    return () => clearInterval(id);
  }, [pending, refreshSilent]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function resend() {
    setSending(true);
    const r = await apiPost("/auth/resend-verification");
    setSending(false);
    if (r.ok) {
      toast.success("New link sent. Check your inbox.");
      setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    if (r.error?.code === "rate_limited") {
      toast.error("Wait a minute before asking again.");
      setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    if (r.error?.code === "already_verified") {
      await refreshSilent();
      return;
    }
    toast.error(r.error?.message || "Couldn't send the link. Try again.");
  }

  async function useDifferentEmail() {
    await logout();
    router.replace("/signup");
  }

  return (
    <AuthCard
      title="Check your inbox"
      lead={`We sent a link to ${user?.email || "your email"}. Open it to finish setting up your account.`}
    >
      <Card tone="sky" radius="lg" padding={14} className="flex items-start gap-3">
        <Mail size={18} className="mt-0.5 shrink-0" />
        <div className="text-[13px] leading-[1.6]">
          The link works for 24 hours, on any device. This page moves on by
          itself once you&apos;ve opened it. Nothing there? Check spam, or send
          a new one.
        </div>
      </Card>

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="soft"
          size="sm"
          onClick={resend}
          disabled={sending || cooldown > 0}
        >
          {sending ? "Sending…" : cooldown > 0 ? `Resend link (${cooldown}s)` : "Resend link"}
        </Button>
        <button
          type="button"
          onClick={useDifferentEmail}
          className="text-[13px] font-bold text-fg"
        >
          Use a different email
        </button>
      </div>
    </AuthCard>
  );
}
