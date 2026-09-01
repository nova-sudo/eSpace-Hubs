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
    <footer
      className="mt-8 flex justify-between border-t border-border py-4 text-[10.5px] text-muted-fg"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <div>
        eSpace/DevHub{me?.team ? ` · ${me.team}` : ""}
      </div>
      <div className="text-dim-fg">
        {new Date().getFullYear()} · eSpace
      </div>
    </footer>
  );
}
