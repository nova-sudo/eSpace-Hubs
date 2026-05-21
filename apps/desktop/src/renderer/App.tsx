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
    settings: {
      get: () => Promise<{
        repoPath?: string;
        tunnelToken?: string;
        autoStartAtLogin?: boolean;
      }>;
      set: (patch: Record<string, unknown>) => Promise<unknown>;
    };
    shell: { openExternal: (url: string) => Promise<void> };
  };
};

const companion = (window as unknown as CompanionWindow).companion;

type BackendStatus = Awaited<ReturnType<typeof companion.backend.status>>;
type ApiPing = Awaited<ReturnType<typeof companion.api.ping>>;
type Settings = Awaited<ReturnType<typeof companion.settings.get>>;

const POLL_INTERVAL_MS = 3000;
const LOG_LINES = 50;

export function App() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [ping, setPing] = useState<ApiPing | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "starting" | "stopping">("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, p, ll, st] = await Promise.all([
        companion.backend.status(),
        companion.api.ping(),
        companion.backend.logs(LOG_LINES),
        companion.settings.get(),
      ]);
      setStatus(s);
      setPing(p);
      setLogs(ll);
      setSettings(st);
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
          Phase 1 · backend control + healthcheck. FortiClient automation lands in Phase 2.
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
