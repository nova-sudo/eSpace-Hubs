"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { readPending, clearPending } from "@/lib/oauth-pkce";
import { describeConnectionError, saveConnection } from "@/features/integrations";
import { proxyFetch } from "@/features/integrations/api-clients/proxy-fetch";
import { toast } from "sonner";

/**
 * GitHub OAuth callback. Exchanges the code, saves the token (and
 * aborts with the real error when the save fails — the old flow
 * toasted "GitHub connected" even when nothing was stored), then
 * returns the user to the Settings → Integrations tab they started
 * from (`pending.returnTo`), not the app root.
 */
export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell status="Loading..." />}>
      <GitHubCallbackInner />
    </Suspense>
  );
}

function CallbackShell({ status, backHref }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div
        className="max-w-[440px] rounded-[var(--radius-xl)] bg-card px-8 py-6 text-[14px] leading-[1.5] text-fg"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div>{status}</div>
        {backHref ? (
          <Link
            href={backHref}
            className="mt-4 inline-block text-[13px] font-bold text-fg hover:underline"
          >
            ← Back to settings
          </Link>
        ) : null}
      </div>
    </main>
  );
}

/**
 * One exchange per authorization code, however many times the effect runs.
 * A GitHub code is single-use: StrictMode's double-invoke (dev), a remount,
 * or a `params` identity change used to exchange it twice — one run won and
 * redirected, the other failed with bad_verification_code and toasted an
 * error over the success. Every run for the same code now awaits the same
 * promise; only the run that is still mounted applies the result.
 */
const exchanges = new Map(); // code → Promise<{ ok, message?, returnTo }>

function exchangeOnce(code, state) {
  if (!exchanges.has(code)) exchanges.set(code, runExchange(code, state));
  return exchanges.get(code);
}

async function runExchange(code, state) {
  const pending = readPending(state);
  const returnTo = pending?.returnTo || "/";
  if (!pending || pending.provider !== "github" || pending.state !== state) {
    return {
      ok: false,
      returnTo,
      message:
        "This sign-in didn't match the one we started (it may have expired). Start again from Settings.",
    };
  }
  try {
    const res = await fetch("/api/oauth/github/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error(`GitHub token exchange failed (${res.status}). Try again.`);
    const tokens = await res.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    // Save + await the mirror so the encrypted token lands
    // server-side before we use the proxy to fetch the user. If
    // the save fails there is nothing to celebrate — say why.
    const saved = await saveConnection("github", {
      accessToken: tokens.access_token,
      tokenType: tokens.token_type,
      scope: tokens.scope,
    });
    if (!saved.ok) {
      throw new Error(
        describeConnectionError(saved.error, {
          provider: "github",
          label: "GitHub",
        }),
      );
    }

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

    clearPending(state);
    return { ok: true, returnTo };
  } catch (e) {
    return { ok: false, returnTo, message: e?.message || "GitHub sign-in failed. Try again." };
  }
}

function GitHubCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState("Finishing GitHub sign-in...");
  const [failed, setFailed] = useState(false);
  const [backHref, setBackHref] = useState("/");

  const code = params.get("code");
  const state = params.get("state");
  const err = params.get("error_description") || params.get("error");

  useEffect(() => {
    let active = true;
    // Read the pending handshake up front so the "back" link works
    // even on the error branches.
    setBackHref(readPending(state)?.returnTo || "/");

    const fail = (message) => {
      setStatus(message);
      setFailed(true);
      toast.error(message);
    };

    if (err) {
      fail(`GitHub said: ${err}. Nothing was connected.`);
      return undefined;
    }
    if (!code) {
      fail("GitHub didn't send an authorization code. Start again from Settings.");
      return undefined;
    }

    void exchangeOnce(code, state).then((result) => {
      if (!active) return;
      setBackHref(result.returnTo);
      if (!result.ok) {
        fail(result.message);
        return;
      }
      toast.success("GitHub connected");
      router.replace(result.returnTo);
    });
    return () => {
      active = false;
    };
  }, [code, state, err, router]);

  return <CallbackShell status={status} backHref={failed ? backHref : null} />;
}
