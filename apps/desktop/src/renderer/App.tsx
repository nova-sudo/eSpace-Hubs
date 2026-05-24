/**
 * Companion-app UI. Two big sections:
 *
 *   1. Status — Docker container running/stopped + API healthcheck
 *      result. Live-updates every 3s. The user's "is it working?"
 *      glance.
 *
 *   2. Controls + settings — Start/Stop backend, repo path picker,
 *      CF tunnel token. Phase 1 keeps these minimal; Phase 2 adds
 *      VPN connect + Phase 3 wires the tunnel hostname into the
 *      Vercel routing.
 */

import { useCallback, useEffect, useState } from "react";

type CompanionWindow = Window & {
  companion: {
    backend: {
      start: () => Promise<{ ok: boolean; message: string }>;
      stop: () => Promise<{ ok: boolean; message: string }>;
      status: () => Promise<{
        running: boolean;
        lastError: string | null;
        repoPath: string;
      }>;
      logs: (lines?: number) => Promise<string[]>;
    };
    api: {
      ping: () => Promise<{
        ok: boolean;
        status: number | null;
        latencyMs: number | null;
        error: string | null;
      }>;
    };
    vpn: {
      status: () => Promise<{
        connected: boolean;
        resolution: "private" | "public" | "nxdomain" | "error";
        resolvedIp: string | null;
        gatedHost: string;
        message: string;
      }>;
      connect: () => Promise<{ ok: boolean; attempted: string; message: string }>;
      disconnect: () => Promise<{ ok: boolean; attempted: string; message: string }>;
      discoverClient: () => Promise<{
        kind: "forticlient" | "openfortivpn" | "none";
        path: string | null;
      }>;
    };
    credentials: {
      has: (key: string) => Promise<{ keychainAvailable: boolean; set: boolean }>;
      set: (key: string, value: string) => Promise<{ ok: boolean }>;
      clear: (key: string) => Promise<{ ok: boolean }>;
    };
    settings: {
      get: () => Promise<{
        repoPath?: string;
        tunnelToken?: string;
        autoStartAtLogin?: boolean;
        vpnUsername?: string;
        vpnGateway?: string;
        vpnProfile?: string;
        vpnGatedHost?: string;
        vpnAutoConnectOnStart?: boolean;
        apiBaseUrl?: string;
        tunnelHostname?: string;
        tunnelAutoRegister?: boolean;
      }>;
      set: (patch: Record<string, unknown>) => Promise<unknown>;
    };
    shell: { openExternal: (url: string) => Promise<void> };
    pair: {
      status: () => Promise<{
        paired: boolean;
        deviceName: string | null;
        deviceId: string | null;
        tunnel: {
          active: boolean;
          hostname: string | null;
          lastSeenAt: string | null;
          lastError: string | null;
        };
      }>;
      start: () => Promise<{
        ok: boolean;
        deviceId?: string;
        deviceName?: string;
        message: string;
      }>;
      cancel: () => Promise<{ ok: boolean }>;
      forget: () => Promise<{ ok: boolean }>;
    };
    tunnel: {
      register: () => Promise<
        | { ok: true; hostname: string }
        | { ok: false; reason: string; message: string }
      >;
      clear: () => Promise<{ ok: boolean }>;
    };
  };
};

const companion = (window as unknown as CompanionWindow).companion;

type BackendStatus = Awaited<ReturnType<typeof companion.backend.status>>;
type ApiPing = Awaited<ReturnType<typeof companion.api.ping>>;
type Settings = Awaited<ReturnType<typeof companion.settings.get>>;
type VpnStatus = Awaited<ReturnType<typeof companion.vpn.status>>;
type VpnClient = Awaited<ReturnType<typeof companion.vpn.discoverClient>>;
type CredentialFlag = Awaited<ReturnType<typeof companion.credentials.has>>;
type PairStatus = Awaited<ReturnType<typeof companion.pair.status>>;

const POLL_INTERVAL_MS = 3000;
const LOG_LINES = 50;

export function App() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [ping, setPing] = useState<ApiPing | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [vpn, setVpn] = useState<VpnStatus | null>(null);
  const [vpnClient, setVpnClient] = useState<VpnClient | null>(null);
  const [vpnPwdFlag, setVpnPwdFlag] = useState<CredentialFlag | null>(null);
  const [vpnPwdDraft, setVpnPwdDraft] = useState("");
  const [pairState, setPairState] = useState<PairStatus | null>(null);
  const [busy, setBusy] = useState<
    | ""
    | "starting"
    | "stopping"
    | "vpn-connect"
    | "vpn-disconnect"
    | "pairing"
    | "tunnel-register"
  >("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, p, ll, st, vs, vc, vp, ps] = await Promise.all([
        companion.backend.status(),
        companion.api.ping(),
        companion.backend.logs(LOG_LINES),
        companion.settings.get(),
        companion.vpn.status(),
        companion.vpn.discoverClient(),
        companion.credentials.has("vpnPassword"),
        companion.pair.status(),
      ]);
      setStatus(s);
      setPing(p);
      setLogs(ll);
      setSettings(st);
      setVpn(vs);
      setVpnClient(vc);
      setVpnPwdFlag(vp);
      setPairState(ps);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const onStart = async () => {
    setBusy("starting");
    setError(null);
    const r = await companion.backend.start();
    if (!r.ok) setError(r.message);
    setBusy("");
    await refresh();
  };
  const onStop = async () => {
    setBusy("stopping");
    setError(null);
    const r = await companion.backend.stop();
    if (!r.ok) setError(r.message);
    setBusy("");
    await refresh();
  };

  const onSettingChange = async (key: string, value: unknown) => {
    await companion.settings.set({ [key]: value });
    await refresh();
  };

  /* ── VPN actions ─────────────────────────────────────────────── */

  const onVpnConnect = async () => {
    setBusy("vpn-connect");
    setError(null);
    const r = await companion.vpn.connect();
    if (!r.ok) setError(r.message);
    setBusy("");
    await refresh();
  };

  const onVpnDisconnect = async () => {
    setBusy("vpn-disconnect");
    setError(null);
    const r = await companion.vpn.disconnect();
    if (!r.ok) setError(r.message);
    setBusy("");
    await refresh();
  };

  const onSavePassword = async () => {
    if (!vpnPwdDraft) return;
    try {
      await companion.credentials.set("vpnPassword", vpnPwdDraft);
      setVpnPwdDraft("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onClearPassword = async () => {
    await companion.credentials.clear("vpnPassword");
    await refresh();
  };

  /* ── Pairing + tunnel actions ────────────────────────────────── */

  const onPair = async () => {
    setBusy("pairing");
    setError(null);
    // Pairing blocks up to ~4½ minutes while the user clicks Approve.
    // We don't want the polling status-refresh interval to fire a
    // duplicate pair attempt; the main process holds an internal
    // single-flight guard, but we also avoid spamming the UI.
    const r = await companion.pair.start();
    if (!r.ok) setError(r.message);
    setBusy("");
    await refresh();
  };

  const onCancelPair = async () => {
    await companion.pair.cancel();
    setBusy("");
    await refresh();
  };

  const onUnpair = async () => {
    await companion.pair.forget();
    await refresh();
  };

  const onTunnelRegister = async () => {
    setBusy("tunnel-register");
    setError(null);
    const r = await companion.tunnel.register();
    if (!r.ok) setError(r.message);
    setBusy("");
    await refresh();
  };

  const onTunnelClear = async () => {
    await companion.tunnel.clear();
    await refresh();
  };

  return (
    <main style={S.shell}>
      <header style={S.header}>
        <div>
          <h1 style={S.title}>eSpace Dev Hub Companion</h1>
          <p style={S.subtitle}>
            Runs the backend container on your machine so the Vercel app can
            reach private resources (Crealogix VPN, internal GitLab, etc.).
          </p>
        </div>
        <Badge ping={ping} running={status?.running ?? false} />
      </header>

      <Section title="Backend">
        <div style={S.row}>
          <Stat
            label="Container"
            value={status?.running ? "running" : "stopped"}
            tone={status?.running ? "good" : "muted"}
          />
          <Stat
            label="API /healthz"
            value={
              ping?.ok
                ? `${ping.status} · ${ping.latencyMs}ms`
                : ping?.error
                ? "unreachable"
                : "—"
            }
            tone={ping?.ok ? "good" : ping?.error ? "bad" : "muted"}
          />
          <Stat
            label="Repo"
            value={status?.repoPath || "(not set)"}
            tone={status?.repoPath ? "muted" : "warn"}
          />
        </div>
        <div style={S.actions}>
          <button
            type="button"
            style={S.btnPrimary}
            disabled={!!busy || status?.running === true}
            onClick={onStart}
          >
            {busy === "starting" ? "Starting…" : "Start backend"}
          </button>
          <button
            type="button"
            style={S.btnSecondary}
            disabled={!!busy || status?.running === false}
            onClick={onStop}
          >
            {busy === "stopping" ? "Stopping…" : "Stop backend"}
          </button>
        </div>
        {(error || status?.lastError) && (
          <div style={S.errorBanner}>{error || status?.lastError}</div>
        )}
      </Section>

      <Section title="VPN (Crealogix)">
        <div style={S.row}>
          <Stat
            label="Tunnel"
            value={vpn?.connected ? "up" : "down"}
            tone={vpn?.connected ? "good" : "bad"}
          />
          <Stat
            label="Gated host"
            value={vpn?.gatedHost || "—"}
            tone="muted"
          />
          <Stat
            label="Resolves to"
            value={vpn?.resolvedIp || vpn?.resolution || "—"}
            tone={
              vpn?.resolution === "private"
                ? "good"
                : vpn?.resolution === "nxdomain"
                ? "bad"
                : "muted"
            }
          />
          <Stat
            label="Client"
            value={
              vpnClient?.kind === "none"
                ? "not found"
                : `${vpnClient?.kind} ✓`
            }
            tone={vpnClient?.kind === "none" ? "warn" : "good"}
          />
        </div>
        <p style={S.helpInline}>{vpn?.message || ""}</p>
        <div style={S.actions}>
          <button
            type="button"
            style={S.btnPrimary}
            disabled={!!busy || vpn?.connected === true}
            onClick={onVpnConnect}
          >
            {busy === "vpn-connect" ? "Connecting…" : "Connect VPN"}
          </button>
          <button
            type="button"
            style={S.btnSecondary}
            disabled={!!busy || vpn?.connected === false}
            onClick={onVpnDisconnect}
          >
            {busy === "vpn-disconnect" ? "Disconnecting…" : "Disconnect VPN"}
          </button>
          <button
            type="button"
            style={S.btnSecondary}
            onClick={() => void refresh()}
          >
            Refresh status
          </button>
        </div>

        {/* Credentials sub-block ─ The plaintext password is sent to
            main ONCE (here) and never echoed back to the renderer. */}
        <Field
          label="Username"
          help="Crealogix VPN username. Sent only when openfortivpn is the active client; FortiClient uses its own saved profile."
        >
          <input
            type="text"
            value={settings.vpnUsername || ""}
            onChange={(e) => onSettingChange("vpnUsername", e.target.value)}
            style={S.input}
          />
        </Field>

        <div style={S.field}>
          <span style={S.fieldLabel}>Password</span>
          {vpnPwdFlag?.set ? (
            <div style={S.row}>
              <span style={{ ...S.statValue, color: "var(--good)" }}>
                stored ✓ in OS keychain
              </span>
              <button
                type="button"
                style={S.btnGhost}
                onClick={onClearPassword}
              >
                Clear
              </button>
            </div>
          ) : (
            <div style={S.row}>
              <input
                type="password"
                value={vpnPwdDraft}
                onChange={(e) => setVpnPwdDraft(e.target.value)}
                placeholder="Crealogix VPN password"
                style={{ ...S.input, flex: 1 }}
              />
              <button
                type="button"
                style={S.btnPrimary}
                disabled={!vpnPwdDraft}
                onClick={onSavePassword}
              >
                Save to keychain
              </button>
            </div>
          )}
          <span style={S.fieldHelp}>
            {vpnPwdFlag?.keychainAvailable
              ? "Encrypted at rest using your OS keychain (Windows DPAPI / macOS Keychain)."
              : "OS keychain isn't available — install libsecret on Linux, then restart the companion."}
          </span>
        </div>

        <Field
          label="FortiClient saved-profile name"
          help="Profile created inside FortiClient's UI. Used when the companion launches FortiClient.exe with `-p <profile>`."
        >
          <input
            type="text"
            value={settings.vpnProfile || ""}
            placeholder="Crealogix"
            onChange={(e) => onSettingChange("vpnProfile", e.target.value)}
            style={S.input}
          />
        </Field>

        <Field
          label="Gated host (probe)"
          help="The companion checks if this hostname resolves to a private IP to know whether the VPN is up."
        >
          <input
            type="text"
            value={settings.vpnGatedHost || ""}
            placeholder="git.bcn.crealogix.net"
            onChange={(e) => onSettingChange("vpnGatedHost", e.target.value)}
            style={S.input}
          />
        </Field>

        <Field
          label="Auto-connect VPN when starting backend"
          help="When the backend starts, bring up the VPN first if it's down."
        >
          <input
            type="checkbox"
            checked={!!settings.vpnAutoConnectOnStart}
            onChange={(e) =>
              onSettingChange("vpnAutoConnectOnStart", e.target.checked)
            }
          />
        </Field>
      </Section>

      <Section title="Pairing & tunnel routing">
        <div style={S.row}>
          <Stat
            label="Companion"
            value={
              pairState?.paired
                ? `paired · ${pairState.deviceName || "(unnamed)"}`
                : "not paired"
            }
            tone={pairState?.paired ? "good" : "warn"}
          />
          <Stat
            label="Tunnel"
            value={
              pairState?.tunnel.active
                ? `live · ${pairState.tunnel.hostname || ""}`
                : pairState?.tunnel.hostname
                ? "registered (stopped)"
                : "off"
            }
            tone={pairState?.tunnel.active ? "good" : "muted"}
          />
          <Stat
            label="Last seen"
            value={
              pairState?.tunnel.lastSeenAt
                ? new Date(pairState.tunnel.lastSeenAt).toLocaleTimeString()
                : "—"
            }
            tone="muted"
          />
        </div>
        {pairState?.tunnel.lastError && (
          <p style={S.helpInline}>{pairState.tunnel.lastError}</p>
        )}
        <div style={S.actions}>
          {pairState?.paired ? (
            <>
              <button
                type="button"
                style={S.btnSecondary}
                onClick={onUnpair}
                disabled={!!busy}
              >
                Forget pairing
              </button>
              {pairState.tunnel.active ? (
                <button
                  type="button"
                  style={S.btnSecondary}
                  onClick={onTunnelClear}
                  disabled={!!busy}
                >
                  Clear tunnel registration
                </button>
              ) : (
                <button
                  type="button"
                  style={S.btnPrimary}
                  onClick={onTunnelRegister}
                  disabled={!!busy}
                >
                  {busy === "tunnel-register" ? "Registering…" : "Register tunnel"}
                </button>
              )}
            </>
          ) : busy === "pairing" ? (
            <>
              <span style={S.helpInline}>
                Approve the device in your browser — this window will update
                as soon as the server sees the approval.
              </span>
              <button
                type="button"
                style={S.btnSecondary}
                onClick={onCancelPair}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              style={S.btnPrimary}
              onClick={onPair}
              disabled={!!busy}
            >
              Pair this device
            </button>
          )}
        </div>
        <Field
          label="Tunnel hostname"
          help="Public hostname your Cloudflare Tunnel exposes the local backend at (e.g. user-42.cf-tunnel.com). Used on backend start to register with the Dev Hub."
        >
          <input
            type="text"
            value={settings.tunnelHostname || ""}
            placeholder="your-name.cf-tunnel.com"
            onChange={(e) => onSettingChange("tunnelHostname", e.target.value.trim())}
            style={S.input}
          />
        </Field>
        <Field
          label="Auto-register tunnel on backend start"
          help="POST the hostname above when the backend comes up, DELETE when it goes down. Heartbeats every 60s while running."
        >
          <input
            type="checkbox"
            checked={settings.tunnelAutoRegister !== false}
            onChange={(e) =>
              onSettingChange("tunnelAutoRegister", e.target.checked)
            }
          />
        </Field>
        <Field
          label="Dev Hub URL"
          help="Where the companion talks to. Defaults to the production deployment; override to point at a preview or localhost for development."
        >
          <input
            type="text"
            value={settings.apiBaseUrl || ""}
            placeholder="https://espace-hubs.vercel.app"
            onChange={(e) => onSettingChange("apiBaseUrl", e.target.value.trim())}
            style={S.input}
          />
        </Field>
      </Section>

      <Section title="Settings">
        <Field
          label="Repo path"
          help="Absolute path to your espace-devhub checkout. The companion runs `docker compose` from here."
        >
          <input
            type="text"
            value={settings.repoPath || ""}
            placeholder="C:\Users\YOU\Desktop\Birdy\espace-devhub"
            onChange={(e) => onSettingChange("repoPath", e.target.value)}
            style={S.input}
          />
        </Field>
        <Field
          label="Cloudflare Tunnel token"
          help="From `cloudflared tunnel token <name>`. Required for the `tunnel` profile."
        >
          <input
            type="password"
            value={settings.tunnelToken || ""}
            placeholder="eyJhIjoi…"
            onChange={(e) => onSettingChange("tunnelToken", e.target.value)}
            style={S.input}
          />
        </Field>
        <Field label="Auto-start at login" help="Launch the companion when you sign into Windows.">
          <input
            type="checkbox"
            checked={!!settings.autoStartAtLogin}
            onChange={(e) => onSettingChange("autoStartAtLogin", e.target.checked)}
          />
        </Field>
      </Section>

      <Section title="Logs">
        <pre style={S.logs}>
          {logs.length === 0 ? "(no logs yet — Start backend to see output)" : logs.join("\n")}
        </pre>
      </Section>

      <footer style={S.footer}>
        <span>
          Phase 3d · pairing + auto-register. Devices UI lands in Phase 3e.
        </span>
        <a
          href="#"
          style={S.link}
          onClick={(e) => {
            e.preventDefault();
            void companion.shell.openExternal(
              "https://github.com/nova-sudo/eSpaceDev/blob/main/docs/RUN_LOCALLY.md",
            );
          }}
        >
          Setup guide ↗
        </a>
      </footer>
    </main>
  );
}

/* ─────────────────── primitives ─────────────────── */

function Badge({
  ping,
  running,
}: {
  ping: ApiPing | null;
  running: boolean;
}) {
  const ok = ping?.ok === true && running;
  const partial = running && !ok;
  const color = ok ? "var(--good)" : partial ? "var(--warn)" : "var(--bad)";
  const label = ok ? "ready" : partial ? "starting…" : "offline";
  return (
    <div style={{ ...S.badge, borderColor: color, color }}>
      <span style={{ ...S.badgeDot, background: color }} />
      {label}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={S.section}>
      <h2 style={S.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "muted" | "warn";
}) {
  const color = {
    good: "var(--good)",
    bad: "var(--bad)",
    warn: "var(--warn)",
    muted: "var(--muted)",
  }[tone];
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, color }}>{value}</div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
      <span style={S.fieldHelp}>{help}</span>
    </label>
  );
}

/* ─────────────────── styles ─────────────────── */

const S: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: 24,
    minHeight: "100vh",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  title: { fontSize: 18, margin: 0 },
  subtitle: {
    margin: "4px 0 0 0",
    color: "var(--muted)",
    fontSize: 12.5,
    lineHeight: 1.5,
    maxWidth: 520,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    border: "1px solid",
    borderRadius: 999,
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  badgeDot: { width: 8, height: 8, borderRadius: "50%" },
  section: {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  sectionTitle: {
    fontSize: 11,
    margin: 0,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  row: { display: "flex", gap: 24, flexWrap: "wrap" },
  stat: { display: "flex", flexDirection: "column", gap: 2, minWidth: 120 },
  statLabel: {
    fontSize: 10,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  statValue: { fontSize: 14, fontWeight: 600 },
  actions: { display: "flex", gap: 8 },
  btnPrimary: {
    background: "var(--accent)",
    color: "white",
    border: 0,
    borderRadius: 4,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    background: "transparent",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "8px 14px",
    fontSize: 12,
    cursor: "pointer",
  },
  btnGhost: {
    background: "transparent",
    color: "var(--muted)",
    border: 0,
    padding: "4px 8px",
    fontSize: 11,
    cursor: "pointer",
    textDecoration: "underline",
  },
  helpInline: {
    fontSize: 11,
    color: "var(--muted)",
    margin: 0,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: 1.4,
  },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: 12, color: "var(--fg)" },
  fieldHelp: { fontSize: 11, color: "var(--muted)" },
  input: {
    background: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  logs: {
    margin: 0,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: 10,
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "var(--muted)",
    maxHeight: 220,
    overflow: "auto",
    whiteSpace: "pre-wrap",
  },
  errorBanner: {
    background: "rgba(248,81,73,0.1)",
    border: "1px solid var(--bad)",
    borderRadius: 4,
    padding: "8px 10px",
    color: "var(--bad)",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  footer: {
    marginTop: "auto",
    display: "flex",
    justifyContent: "space-between",
    color: "var(--muted)",
    fontSize: 11,
  },
  link: { color: "var(--accent)", textDecoration: "none" },
};
