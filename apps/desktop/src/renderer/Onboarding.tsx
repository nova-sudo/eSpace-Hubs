/**
 * First-run onboarding wizard.
 *
 * Overlay shown on top of App.tsx until the user finishes the
 * required setup. Driven by `settings.onboardingCompletedAt` — set
 * via `companion.settings.set({ onboardingCompletedAt: <iso> })`
 * once the user finishes; the App.tsx-level check reads the value
 * on next refresh and unmounts this component.
 *
 * Steps (linear, can't skip ahead):
 *   1. Docker check
 *   2. Repo path (native folder picker)
 *   3. Tunnel hostname
 *   4. Pair this device
 *
 * Why not a multi-page router
 * ───────────────────────────
 * One vertical list, all visible, each step disabled until the prior
 * is satisfied. Users see how much is left and can scroll back to
 * inspect what they did. Same convention as the eSpace Dev Hub
 * /onboarding web form.
 */

import { useEffect, useState } from "react";

type CompanionApi = (Window & {
  companion: {
    onboarding: {
      checkDocker: () => Promise<{
        installed: boolean;
        version: string | null;
        message: string;
      }>;
      chooseDirectory: (title?: string) => Promise<{
        canceled: boolean;
        path: string | null;
      }>;
    };
    settings: {
      get: () => Promise<Record<string, unknown>>;
      set: (patch: Record<string, unknown>) => Promise<unknown>;
    };
    pair: {
      status: () => Promise<{ paired: boolean; deviceName: string | null }>;
      start: () => Promise<{ ok: boolean; message: string }>;
      cancel: () => Promise<{ ok: boolean }>;
    };
  };
})["companion"];

const companion = (window as unknown as { companion: CompanionApi }).companion;

interface OnboardingProps {
  /** Called with the ISO ts the user finishes — App.tsx persists +
   *  unmounts. */
  onComplete: (completedAt: string) => void;
}

type DockerState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "ok"; version: string }
  | { phase: "missing"; message: string };

export function Onboarding({ onComplete }: OnboardingProps) {
  const [dockerState, setDockerState] = useState<DockerState>({ phase: "idle" });
  const [repoPath, setRepoPath] = useState("");
  const [tunnelHostname, setTunnelHostname] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [paired, setPaired] = useState(false);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairMessage, setPairMessage] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Hydrate any pre-existing settings — useful when the user
  // partially configured the app from the main UI before triggering
  // the wizard, OR when "Restart onboarding" is added later.
  useEffect(() => {
    void (async () => {
      const s = await companion.settings.get();
      if (typeof s.repoPath === "string") setRepoPath(s.repoPath);
      if (typeof s.tunnelHostname === "string") setTunnelHostname(s.tunnelHostname);
      if (typeof s.apiBaseUrl === "string") setApiBaseUrl(s.apiBaseUrl);
      const p = await companion.pair.status();
      setPaired(p.paired);
    })();
  }, []);

  const dockerOk = dockerState.phase === "ok";
  const repoOk = !!repoPath.trim();
  const tunnelOk = !!tunnelHostname.trim() && tunnelHostname.includes(".");
  const canFinish = dockerOk && repoOk && tunnelOk && paired;

  async function runDockerCheck() {
    setDockerState({ phase: "checking" });
    const r = await companion.onboarding.checkDocker();
    if (r.installed) {
      setDockerState({ phase: "ok", version: r.version || "Docker found." });
    } else {
      setDockerState({ phase: "missing", message: r.message });
    }
  }

  async function chooseRepo() {
    const r = await companion.onboarding.chooseDirectory(
      "Pick your espace-devhub checkout",
    );
    if (!r.canceled && r.path) {
      setRepoPath(r.path);
      await companion.settings.set({ repoPath: r.path });
    }
  }

  async function startPair() {
    setPairBusy(true);
    setPairMessage(null);
    // Persist current hostname/url BEFORE pairing so the user doesn't
    // have to remember to save them — the next backend:start can
    // immediately register.
    await companion.settings.set({
      tunnelHostname: tunnelHostname.trim(),
      apiBaseUrl: apiBaseUrl.trim() || undefined,
    });
    const r = await companion.pair.start();
    setPairBusy(false);
    setPairMessage(r.message);
    if (r.ok) setPaired(true);
  }

  async function cancelPair() {
    await companion.pair.cancel();
    setPairBusy(false);
  }

  async function finish() {
    setFinishing(true);
    const now = new Date().toISOString();
    await companion.settings.set({ onboardingCompletedAt: now });
    setFinishing(false);
    onComplete(now);
  }

  return (
    <div style={S.overlay}>
      <div style={S.shell}>
        <header style={S.header}>
          <h1 style={S.title}>Welcome to the Companion.</h1>
          <p style={S.subtitle}>
            Four steps to route the eSpace Dev Hub through your laptop.
            You only do this once.
          </p>
        </header>

        <Step
          n={1}
          title="Docker Desktop"
          done={dockerOk}
          locked={false}
          help="The companion runs the backend as a Docker compose stack. We just need to know the CLI is on PATH; the daemon itself starts on demand."
        >
          {dockerState.phase === "idle" && (
            <Button onClick={runDockerCheck} variant="primary">
              Check for Docker
            </Button>
          )}
          {dockerState.phase === "checking" && (
            <span style={S.muted}>Checking…</span>
          )}
          {dockerState.phase === "ok" && (
            <span style={S.good}>✓ {dockerState.version}</span>
          )}
          {dockerState.phase === "missing" && (
            <div style={S.errorBlock}>
              <span style={S.bad}>{dockerState.message}</span>
              <Button onClick={runDockerCheck} variant="secondary">
                Recheck
              </Button>
            </div>
          )}
        </Step>

        <Step
          n={2}
          title="Repository folder"
          done={repoOk}
          locked={!dockerOk}
          help="Absolute path to your espace-devhub checkout. The companion runs `docker compose` from there."
        >
          <div style={S.row}>
            <input
              type="text"
              readOnly
              value={repoPath}
              placeholder="No folder selected"
              style={{ ...S.input, flex: 1 }}
            />
            <Button onClick={chooseRepo} variant="primary" disabled={!dockerOk}>
              Pick folder
            </Button>
          </div>
        </Step>

        <Step
          n={3}
          title="Tunnel hostname"
          done={tunnelOk}
          locked={!repoOk}
          help="Public hostname your Cloudflare Tunnel exposes the local backend at (e.g. user-42.cf-tunnel.com). The Dev Hub website asks this hostname for /api/v1/* once you click Start backend."
        >
          <input
            type="text"
            value={tunnelHostname}
            onChange={(e) => setTunnelHostname(e.target.value.trim())}
            placeholder="your-name.cf-tunnel.com"
            style={S.input}
            disabled={!repoOk}
          />
          <details style={S.details}>
            <summary style={S.detailsSummary}>
              Advanced: override Dev Hub URL
            </summary>
            <input
              type="text"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value.trim())}
              placeholder="https://espace-hubs.vercel.app"
              style={{ ...S.input, marginTop: 8 }}
              disabled={!repoOk}
            />
            <p style={S.help}>
              Leave blank to use production. Override only when developing
              against a preview deploy or localhost.
            </p>
          </details>
        </Step>

        <Step
          n={4}
          title="Pair this device"
          done={paired}
          locked={!tunnelOk}
          help="Opens your default browser to the eSpace Dev Hub approval page. You'll see the pairing code and the IP that initiated it before approving."
        >
          {paired ? (
            <span style={S.good}>✓ Paired. You're ready to go.</span>
          ) : pairBusy ? (
            <div style={S.row}>
              <span style={S.muted}>
                Approve in your browser. The wizard will update as soon as the
                server sees the approval.
              </span>
              <Button onClick={cancelPair} variant="secondary">
                Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={startPair} variant="primary" disabled={!tunnelOk}>
              Pair this device
            </Button>
          )}
          {pairMessage && !paired && (
            <span style={S.muted}>{pairMessage}</span>
          )}
        </Step>

        <footer style={S.footer}>
          <Button
            onClick={finish}
            variant="primary"
            disabled={!canFinish || finishing}
          >
            {finishing ? "Finishing…" : "Finish setup"}
          </Button>
          {!canFinish && (
            <span style={S.muted}>
              Complete every step above to enable Finish.
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

/* ─────────────────── components ─────────────────── */

function Step({
  n,
  title,
  done,
  locked,
  help,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  locked: boolean;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ ...S.step, opacity: locked ? 0.5 : 1 }}>
      <div style={S.stepHead}>
        <span
          style={{
            ...S.stepNum,
            background: done ? "var(--good)" : "var(--border)",
            color: done ? "white" : "var(--muted)",
          }}
        >
          {done ? "✓" : n}
        </span>
        <h2 style={S.stepTitle}>{title}</h2>
      </div>
      <p style={S.help}>{help}</p>
      <div style={S.stepBody}>{children}</div>
    </section>
  );
}

function Button({
  onClick,
  variant,
  disabled,
  children,
}: {
  onClick: () => void;
  variant: "primary" | "secondary";
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...S.btn,
        ...(variant === "primary" ? S.btnPrimary : S.btnSecondary),
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ─────────────────── styles ─────────────────── */

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(14, 17, 22, 0.92)",
    backdropFilter: "blur(8px)",
    overflowY: "auto",
    padding: 32,
    boxSizing: "border-box",
  },
  shell: {
    maxWidth: 560,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  header: { marginBottom: 8 },
  title: { fontSize: 22, margin: 0 },
  subtitle: {
    margin: "6px 0 0 0",
    color: "var(--muted)",
    fontSize: 13,
    lineHeight: 1.5,
  },
  step: {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  stepHead: { display: "flex", alignItems: "center", gap: 10 },
  stepNum: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: "50%",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    fontWeight: 700,
  },
  stepTitle: { margin: 0, fontSize: 15 },
  stepBody: { display: "flex", flexDirection: "column", gap: 8 },
  help: {
    margin: 0,
    fontSize: 12,
    color: "var(--muted)",
    lineHeight: 1.5,
  },
  row: { display: "flex", gap: 8, alignItems: "center" },
  input: {
    background: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  details: { fontSize: 12, color: "var(--muted)" },
  detailsSummary: {
    cursor: "pointer",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
  },
  btn: {
    border: 0,
    borderRadius: 4,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
  },
  btnPrimary: { background: "var(--accent)", color: "white" },
  btnSecondary: {
    background: "transparent",
    color: "var(--fg)",
    border: "1px solid var(--border)",
  },
  good: { fontSize: 12, color: "var(--good)" },
  bad: { fontSize: 12, color: "var(--bad)" },
  muted: { fontSize: 12, color: "var(--muted)" },
  errorBlock: { display: "flex", flexDirection: "column", gap: 6 },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
};
