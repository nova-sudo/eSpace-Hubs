"use client";

/**
 * Soft auth gate for one-shot pages that live OUTSIDE AuthGuard (e.g.
 * /companion/pair). Unlike AuthGuard it never redirects on its own —
 * it renders a "Sign in" card whose link carries the current URL as
 * `?next=`, so the user lands back on the exact page after login.
 *
 * Use AuthGuard for hub pages; use this where a redirect would lose
 * a query string the page needs (a pairing code, a token).
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Card, Loading } from "@/components/ui";
import { useSession } from "./use-session.js";

export function SignInGate({ children, reason }) {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const params = useSearchParams();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="Loading…" />
      </div>
    );
  }
  if (user) return children;

  const query = params.toString();
  const here = `${pathname}${query ? `?${query}` : ""}`;
  const loginHref = `/login?next=${encodeURIComponent(here)}`;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-[420px] p-8">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-fg">
          Sign in to continue
        </h1>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-muted-fg">
          {reason ||
            "You need to be signed in to your eSpace Hubs account for this."}{" "}
          You&apos;ll come straight back here afterwards.
        </p>
        <Link
          href={loginHref}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-[var(--radius-pill)] bg-ink px-5 text-[14px] font-bold text-ink-on hover:opacity-90"
        >
          Sign in
        </Link>
      </Card>
    </div>
  );
}
