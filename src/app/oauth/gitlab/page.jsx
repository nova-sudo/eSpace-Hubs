"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readPending, clearPending } from "@/lib/oauth-pkce";
import { saveConnection } from "@/lib/integrations";
import { toast } from "sonner";

export default function GitLabCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell status="Loading..." />}>
      <GitLabCallbackInner />
    </Suspense>
  );
}

function CallbackShell({ status }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="rounded-2xl border border-border bg-card/60 px-8 py-6 text-sm">
        {status}
      </div>
    </main>
  );
}

function GitLabCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState("Finishing GitLab sign-in...");

  useEffect(() => {
    (async () => {
      const code = params.get("code");
      const state = params.get("state");
      const errorDesc = params.get("error_description") || params.get("error");

      if (errorDesc) {
        setStatus(`GitLab error: ${errorDesc}`);
        toast.error(`GitLab: ${errorDesc}`);
        return;
      }
      if (!code) {
        setStatus("Missing authorization code.");
        return;
      }

      const pending = readPending();
      if (!pending || pending.provider !== "gitlab" || pending.state !== state) {
        setStatus("OAuth state mismatch — please retry from Settings.");
        toast.error("OAuth state mismatch");
        return;
      }

      try {
        const res = await fetch("/api/oauth/gitlab/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, codeVerifier: pending.codeVerifier }),
        });
        if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
        const tokens = await res.json();

        saveConnection("gitlab", {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
          tokenType: tokens.token_type,
        });

        const meRes = await fetch("/api/gitlab/user", {
          headers: { "x-devhub-token": tokens.access_token },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          saveConnection("gitlab", {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresIn: tokens.expires_in,
            tokenType: tokens.token_type,
            username: me.username,
            displayName: me.name,
            avatarUrl: me.avatar_url,
          });
        }

        clearPending();
        toast.success("GitLab connected");
        router.replace("/");
      } catch (e) {
        setStatus(e.message);
        toast.error(e.message);
      }
    })();
  }, [params, router]);

  return <CallbackShell status={status} />;
}
