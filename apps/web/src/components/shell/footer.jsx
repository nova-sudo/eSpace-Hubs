"use client";

import { useIntegrations } from "@/features/integrations";

/**
 * Audit #239: this used to claim "refreshed just now" unconditionally
 * (nothing measured any refresh) and linked to a GitHub repo that
 * doesn't exist. A footer that lies twice in one line trains users to
 * ignore it — say only what's true.
 */
export function Footer() {
  const { me } = useIntegrations();
  return (
    <footer className="mt-8 flex justify-between py-4 text-[12.5px] text-muted-fg">
      <div>eSpace Hubs{me?.team ? ` · ${me.team}` : ""}</div>
      <div className="flex gap-4 text-muted-fg">
        <a href="/docs" className="text-muted-fg underline-offset-2 hover:text-fg hover:underline">
          Docs
        </a>
        <span>{new Date().getFullYear()} · eSpace</span>
      </div>
    </footer>
  );
}
