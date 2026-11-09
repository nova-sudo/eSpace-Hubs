"use client";

/**
 * /verify-email?token=… — redeems the emailed link.
 *
 * Public: the link is often opened on a device with no session. On
 * success a signed-in browser continues the setup chain (AuthGuard
 * takes it to 2FA setup → onboarding); a browser without a session
 * goes to /login?verified=1. A reused or expired link is not a dead
 * end: an already-active session just continues, an unverified one
 * can send a fresh link.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button, Loading } from "@/components/ui";
import { AuthCard } from "./auth-card.jsx";
import { useSession } from "./use-session.js";

export function VerifyEmailView() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const { user, loading, refreshSilent } = useSession();
  const [state, setState] = useState("working"); // working | failed
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    (async () => {
      const r = token
        ? await apiPost("/auth/verify-email", { token })
        : { ok: false, error: { code: "invalid_token" } };
      if (r.ok) {
        if (user) {
          await refreshSilent();
          router.replace("/");
        } else {
          router.replace("/login?verified=1");
        }
        return;
      }
      // Link already used (double click, mail scanner) but this
      // browser's account is active anyway → just continue.
      if (user && user.status !== "pending_email") {
        router.replace("/");
        return;
      }
      setState("failed");
    })();
  }, [loading, token, user, refreshSilent, router]);

  async function resend() {
    const r = await apiPost("/auth/resend-verification");
    if (r.ok) toast.success("New link sent. Check your inbox.");
    else if (r.error?.code === "rate_limited") toast.error("Wait a minute before asking again.");
    else toast.error(r.error?.message || "Couldn't send the link. Try again.");
  }

  if (state === "working") {
    return (
      <AuthCard title="Confirming your email" lead="One moment…">
        <Loading label="Checking the link…" />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="This link didn't work"
      lead="It has expired or was already used. Links work for 24 hours."
    >
      <div className="flex items-center justify-between">
        {user?.status === "pending_email" ? (
          <Button size="sm" onClick={resend}>
            Send a new link
          </Button>
        ) : (
          <Link href="/login" className="text-[13px] font-bold text-fg">
            Sign in
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
