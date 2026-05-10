"use client";

import { useIntegrations } from "@/features/integrations";

export function Footer() {
  const { me } = useIntegrations();
  return (
    <footer
      className="mt-8 flex justify-between border-t border-border py-4 text-[10.5px] text-muted-fg"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <div>
        eSpace/DevHub{me?.team ? ` · ${me.team}` : ""} · refreshed just now
      </div>
      <a
        href="https://github.com/espace/devhub"
        target="_blank"
        rel="noreferrer"
        className="hover:text-fg"
      >
        ↗ github.com/espace/devhub
      </a>
    </footer>
  );
}
