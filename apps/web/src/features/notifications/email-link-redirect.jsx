"use client";

/**
 * Landing for links in emails: `/n/<notificationId>` (the button) and
 * `/email-settings` (the footer). Signs the visitor in if needed (AuthGuard
 * bounces to /login?next=…), marks the row read, then replaces the URL with
 * the page the inbox would open — resolveEmailTarget picks the hub.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/features/auth";
import { getValidPick, useAvailableHubs } from "@/features/hubs";
import { apiGet, apiPost } from "@/lib/api-client";
import { EMAIL_SETTINGS, resolveEmailTarget } from "./email-target.js";

const Placeholder = () => (
  <div style={{ minHeight: "100vh", background: "var(--bg)" }} aria-busy="true" />
);

export function EmailLinkRedirect({ id = null, settings = false }) {
  return (
    <AuthGuard fallback={<Placeholder />}>
      <Inner id={id} settings={settings} />
    </AuthGuard>
  );
}

function Inner({ id, settings }) {
  const router = useRouter();
  const { status, hubs, primaryHubId } = useAvailableHubs();
  // undefined = still loading; null = not found / not mine.
  const [row, setRow] = useState(settings ? EMAIL_SETTINGS : undefined);

  useEffect(() => {
    if (settings || !id) return;
    let live = true;
    apiGet(`/notifications/${encodeURIComponent(id)}`).then((r) => {
      if (!live) return;
      const n = r.ok ? r.data?.notification ?? null : null;
      setRow(n);
      if (n) void apiPost(`/notifications/${encodeURIComponent(id)}/read`, {});
    });
    return () => {
      live = false;
    };
  }, [id, settings]);

  useEffect(() => {
    if (row === undefined || status === "loading") return;
    const ids = (hubs ?? []).map((h) => h.id);
    router.replace(
      resolveEmailTarget({
        row,
        hubs: status === "ready" ? hubs : [],
        pick: ids.length ? getValidPick(ids) : null,
        primaryHubId,
      }),
    );
  }, [row, status, hubs, primaryHubId, router]);

  return <Placeholder />;
}

export default EmailLinkRedirect;
