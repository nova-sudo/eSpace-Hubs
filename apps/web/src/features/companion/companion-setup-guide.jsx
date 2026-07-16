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

import { useApiOrigin } from "./use-api-origin.js";

export function CompanionSetupGuide() {
  const { source, hostname, staleHostname } = useApiOrigin();
  const live = source === "companion";
  const stale = source === "bundled" && !!staleHostname;

  return (
    <section
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-sub, 3px)",
        background: "var(--card)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginBottom: 16,
      }}
    >
      <StatusLine live={live} stale={stale} hostname={hostname || staleHostname} />

      <Step
        num={1}
        title="Install the companion app"
        body={
          <>
            <p style={{ margin: "0 0 10px 0" }}>
              Download and run the installer. The companion runs in your
              system tray; it starts a local copy of the backend and
              forwards requests through a Cloudflare Tunnel.
            </p>
            <a
              href="https://github.com/nova-sudo/eSpace-Hubs/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sub)] px-3.5 py-2 text-[11px] font-normal uppercase tracking-[0.8px] transition-opacity hover:opacity-90"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--accent)",
                color: "var(--accent-on)",
              }}
            >
              Download for Windows ↗
            </a>
            <span
              style={{
                display: "block",
                marginTop: 6,
                fontSize: 11,
                color: "var(--muted-fg)",
              }}
            >
              macOS/Linux builds are on the same{" "}
              <a
                href="https://github.com/nova-sudo/eSpace-Hubs/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)" }}
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
            seconds. The chip in the top-right of this page flips green
            once routing is live.
          </>
        }
      />

      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          color: "var(--muted-fg)",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        Auth model: the companion holds a per-device bearer token
        encrypted by your OS keychain (DPAPI on Windows, Keychain on
        macOS). The token never leaves your machine; revoking from the
        list below makes it useless on the next request.
      </p>
    </section>
  );
}

function StatusLine({ live, stale, hostname }) {
  if (live) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          color: "var(--good)",
          fontFamily: "var(--font-mono)",
        }}
      >
        ● Routing live via <strong>{hostname}</strong>. Your /api/v1/*
        calls are reaching your laptop's backend.
      </p>
    );
  }
  if (stale) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 12.5,
          color: "var(--warn)",
          fontFamily: "var(--font-mono)",
        }}
      >
        ● Companion offline — last heartbeat from <strong>{hostname}</strong>{" "}
        went stale. Open the desktop app to resume routing; we're
        falling back to the bundled API in the meantime.
      </p>
    );
  }
  return (
    <p
      style={{
        margin: 0,
        fontSize: 12.5,
        color: "var(--muted-fg)",
        fontFamily: "var(--font-mono)",
      }}
    >
      No companion registered. Follow the steps below if your engagement
      requires routing through your local laptop (Crealogix, etc.).
    </p>
  );
}

function Step({ num, title, body }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr",
        gap: 12,
        alignItems: "start",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.5px",
          color: "var(--accent)",
          paddingTop: 2,
        }}
      >
        {String(num).padStart(2, "0")}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--fg)" }}>
          {body}
        </div>
      </div>
    </div>
  );
}

function Code({ children }) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        background: "var(--bg)",
        border: "1px solid var(--border-strong)",
        borderRadius: 2,
        padding: "1px 5px",
      }}
    >
      {children}
    </code>
  );
}
