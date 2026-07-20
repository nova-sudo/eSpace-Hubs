"use client";

/**
 * Active-hub provider for app/[hub]/layout.jsx.
 *
 * Resolves the URL slug against:
 *   1. The shared registry (HUBS) — does this hub exist at all?
 *   2. The user's allowedHubs    — does the current user have access?
 *
 * Failure modes:
 *   - URL slug not in the registry → redirect to primary hub
 *     (typo, stale bookmark, hub was removed)
 *   - URL slug not in user's allowed list → redirect to primary hub
 *     (admin revoked access mid-session, or user pasted someone
 *     else's URL)
 *   - useAvailableHubs() still loading → render placeholder; we never
 *     bounce mid-load because a redirect during loading would race
 *     with the session restore.
 *
 * On success: applies the hub's CSS variable overrides to a wrapping
 * <div> (theme = primary/accent/accentSurface) and provides the
 * HubDefinition via HubContext to descendants.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { findHubById } from "@espace-devhub/shared/hubs";
import { useSession } from "@/features/auth";
import { useAvailableHubs } from "./use-available-hubs";
import { HubContext } from "./hub-context";

function themeStyle(hub) {
  // Base hubs share the single cobalt accent from globals.css; `--primary`
  // is exposed here for any non-accent hub references. Hubs that need a full
  // re-skin (e.g. the Manager hub's warm-white/orange identity) do it via a
  // `[data-hub="<id>"]` token scope in globals.css — stamped through the
  // `data-hub` attribute on the wrapper below — which dark-switches cleanly,
  // unlike the old inline per-hub accents.
  return {
    "--primary": hub.theme.primary,
    // Paint the (possibly per-hub-overridden) surface token as the page
    // ground. Without this the body — which sits OUTSIDE this [data-hub]
    // scope — keeps painting the base --bg, so a re-skinned hub's whiter
    // background never actually showed. min-height keeps it covering the
    // viewport even on short pages.
    background: "var(--bg)",
    minHeight: "100dvh",
  };
}

export function HubProvider({ hubSlug, children }) {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const { status: hubsStatus, hubs, primaryHubId } = useAvailableHubs();

  // Validate the URL slug exists at all (registry membership) and
  // that the user has access (allowedHubs membership).
  const registryHub = findHubById(hubSlug);
  const userHub = hubs.find((h) => h.id === hubSlug) ?? null;

  // The hub we'll actually render: prefer the user-allowed match so
  // we get the same identity used elsewhere; fall back to the
  // registry record only for the loading window.
  const activeHub = userHub ?? registryHub ?? null;

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) return; // AuthGuard handles unauthenticated state
    if (hubsStatus !== "ready") return;
    if (userHub) return; // good — user has access

    // We have a session, hubs are loaded, but the URL slug isn't in
    // the user's allowed list. Bounce to their primary hub (or the
    // first allowed hub as a defensive fallback).
    const fallback = primaryHubId || hubs[0]?.id || null;
    if (fallback) {
      router.replace(`/${fallback}`);
    }
  }, [sessionLoading, user, hubsStatus, userHub, primaryHubId, hubs, router]);

  // Tiny placeholder during the loading window. Stays minimal so the
  // pageshell flashes for the smallest possible time before the real
  // content renders.
  if (!activeHub) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
        }}
        aria-busy="true"
      />
    );
  }

  return (
    <HubContext.Provider value={activeHub}>
      <div data-hub={activeHub.id} style={themeStyle(activeHub)}>
        {children}
      </div>
    </HubContext.Provider>
  );
}
