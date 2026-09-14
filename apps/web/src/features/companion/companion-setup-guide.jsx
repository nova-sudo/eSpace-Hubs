"use client";

/**
 * Setup-guide explainer for the Companion settings tab.
 *
 * Audience: any user whose engagement requires routing API calls
 * through a local backend (today: Crealogix, because Vercel can't
 * reach git.bcn.crealogix.net). Espace devs don't need it.
 *
 * Decisions baked into the copy:
 *   - Step 1 links straight to the latest GitHub Release rather than
 *     streaming a file ourselves — electron-builder's artifactName
 *     includes the version, so there's no stable one-click asset URL
 *     without also pinning a fixed filename. /releases/latest degrades
 *     gracefully (shows "no releases yet") if none has been cut.
 *   - The CF tunnel hostname is user-provided. Phase 4 wraps the
 *     `cloudflared` CLI so the companion mints the hostname itself,
 *     but for v1 we let the user paste their existing one.
 */

import { ArrowUpRight } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { useApiOrigin } from "./use-api-origin.js";

export function CompanionSetupGuide() {
  const { source, hostname, staleHostname } = useApiOrigin();
  const live = source === "companion";
  const stale = source === "bundled" && !!staleHostname;

  return (
    <Card className="p-6">
      <StatusLine live={live} stale={stale} hostname={hostname || staleHostname} />

      <div className="mt-4 flex flex-col gap-4">
        <Step
          num={1}
          title="Install the companion app"
          body={
            <>
              <p className="mb-2.5">
                Download and run the installer. The companion runs in your
                system tray; it starts a local copy of the backend and
                forwards requests through a Cloudflare Tunnel.
              </p>
              <a
                href="https://github.com/nova-sudo/eSpace-Hubs/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)] bg-ink px-4 text-[13px] font-bold text-ink-on transition-opacity hover:opacity-90"
              >
                Download for Windows
                <ArrowUpRight size={14} />
              </a>
              <span className="mt-1.5 block text-[11.5px] text-muted-fg">
                macOS/Linux builds are on the same{" "}
                <a
                  href="https://github.com/nova-sudo/eSpace-Hubs/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-fg hover:underline"
                >
                  releases page
                </a>
                .
              </span>
            </>
          }
        />

        <Step
          num={2}
          title="Set up a Cloudflare Tunnel"
          body={
            <>
              From the Cloudflare Zero Trust dashboard, create a tunnel
              and copy its <Code>token</Code>. In the companion's Settings
              section, paste the token AND the public hostname you bound
              to the tunnel (e.g. <Code>your-name.cf-tunnel.com</Code>).
              Phase 4 will mint a named tunnel for you automatically; for
              now you provide the hostname yourself.
            </>
          }
        />

        <Step
          num={3}
          title="Pair this browser with your companion"
          body={
            <>
              In the companion, click <strong>Pair this device</strong>.
              Your browser opens to <Code>/companion/pair?code=…</Code>,
              shows the pairing code and the IP that initiated it, and
              asks you to confirm. Approve only pairings you started.
            </>
          }
        />

        <Step
          num={4}
          title="Start the backend"
          body={
            <>
              Click <strong>Start backend</strong> in the companion. The
              Docker stack comes up, the tunnel hostname is registered
              with the Dev Hub, and a heartbeat keeps it fresh every 60
              seconds. The chip in the top-right of this page turns mint
              once routing is live.
            </>
          }
        />
      </div>

      <p className="mt-5 text-[12px] leading-[1.6] text-dim-fg">
        Auth model: the companion holds a per-device bearer token
        encrypted by your OS keychain (DPAPI on Windows, Keychain on
        macOS). The token never leaves your machine; revoking from the
        list below makes it useless on the next request.
      </p>
    </Card>
  );
}

function StatusLine({ live, stale, hostname }) {
  if (live) {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge tone="mint" dot>
          Routing live
        </Badge>
        <span className="text-[12.5px] text-muted-fg">
          via <strong className="text-fg">{hostname}</strong> — your /api/v1/*
          calls are reaching your laptop's backend.
        </span>
      </div>
    );
  }
  if (stale) {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge tone="lemon" dot>
          Companion offline
        </Badge>
        <span className="text-[12.5px] text-muted-fg">
          last heartbeat from <strong className="text-fg">{hostname}</strong>{" "}
          went stale. Open the desktop app to resume routing; we're falling
          back to the bundled API in the meantime.
        </span>
      </div>
    );
  }
  return (
    <p className="text-[12.5px] text-muted-fg">
      No companion registered. Follow the steps below if your engagement
      requires routing through your local laptop (Crealogix, etc.).
    </p>
  );
}

function Step({ num, title, body }) {
  return (
    <div className="grid grid-cols-[28px_1fr] items-start gap-3">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-card-alt text-[12px] font-bold text-fg">
        {num}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-bold text-fg">{title}</span>
        <div className="text-[12.5px] leading-[1.6] text-muted-fg">{body}</div>
      </div>
    </div>
  );
}

function Code({ children }) {
  return (
    <code className="rounded-[var(--radius-md)] bg-card-alt px-1.5 py-0.5 font-mono text-[11px] text-fg">
      {children}
    </code>
  );
}
