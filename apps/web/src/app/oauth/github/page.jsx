"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readPending, clearPending } from "@/lib/oauth-pkce";
import { saveConnection } from "@/features/integrations";
import { proxyFetch } from "@/features/integrations/api-clients/proxy-fetch";
import { toast } from "sonner";

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell status="Loading..." />}>
      <GitHubCallbackInner />
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

function GitHubCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState("Finishing GitHub sign-in...");

  useEffect(() => {
    (async () => {
      const code = params.get("code");
      const state = params.get("state");
      const err = params.get("error_description") || params.get("error");

      if (err) {
        setStatus(`GitHub error: ${err}`);
        toast.error(`GitHub: ${err}`);
        return;
      }
      if (!code) {
        setStatus("Missing authorization code.");
        return;
      }

      const pending = readPending();
      if (!pending || pending.provider !== "github" || pending.state !== state) {
        setStatus("OAuth state mismatch — please retry from Settings.");
        toast.error("OAuth state mismatch");
        return;
      }

      try {
        const res = await fetch("/api/oauth/github/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
        const tokens = await res.json();
        if (tokens.error) throw new Error(tokens.error_description || tokens.error);

        // Save + await the mirror so the encrypted token lands
        // server-side before we use the proxy to fetch the user.
        await saveConnection("github", {
          accessToken: tokens.access_token,
          tokenType: tokens.token_type,
          scope: tokens.scope,
        });

        try {
          const me = await proxyFetch("github", "user");
          await saveConnection("github", {
            accessToken: tokens.access_token,
            tokenType: tokens.token_type,
            scope: tokens.scope,
            username: me.login,
            displayName: me.name,
            avatarUrl: me.avatar_url,
          });
        } catch {
          // Profile lookup failure shouldn't break the OAuth flow —
          // the token is already saved + verified by the exchange.
          // The header chip will just lack the avatar/displayName.
        }

        clearPending();
        toast.success("GitHub connected");
        router.replace("/");
      } catch (e) {
        setStatus(e.message);
        toast.error(e.message);
      }
    })();
  }, [params, router]);

  return <CallbackShell status={status} />;
}
