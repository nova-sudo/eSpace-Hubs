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
 *   1. System requirements (Docker + cloudflared)
 *   2. Repo folder (native folder picker)
 *   3. Pair this device
 *
 * The tunnel hostname is no longer a step — the companion auto-spawns
 * `cloudflared tunnel --url http://localhost:4000` when the user
 * clicks Start backend, parses the *.trycloudflare.com hostname from
 * its log output, and auto-registers with the Dev Hub. Zero typing.
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
      checkCloudflared: () => Promise<{
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
    shell: { openExternal: (url: string) => Promise<void> };
  };
})["companion"];

const companion = (window as unknown as { companion: CompanionApi }).companion;

interface OnboardingProps {
  /** Called with the ISO ts the user finishes — App.tsx persists +
   *  unmounts. */
  onComplete: (completedAt: string) => void;
}

type ToolState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "ok"; version: string }
  | { phase: "missing"; message: string };

const cfInstallHint = {
  win: "winget install --id Cloudflare.cloudflared",
  mac: "brew install cloudflared",
  linux: "apt install cloudflared  # or your distro's equivalent",
};

export function Onboarding({ onComplete }: OnboardingProps) {
  const [dockerState, setDockerState] = useState<ToolState>({ phase: "idle" });
  const [cfState, setCfState] = useState<ToolState>({ phase: "idle" });
  const [repoPath, setRepoPath] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [paired, setPaired] = useState(false);
  const [pairBusy, setPairBusy] = useState(false);
  const [pairMessage, setPairMessage] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Hydrate any pre-existing settings — useful when the user
  // partially configured the app from the main UI before triggering
  // the wizard.
  useEffect(() => {
    void (async () => {
      const s = await companion.settings.get();
      if (typeof s.repoPath === "string") setRepoPath(s.repoPath);
      if (typeof s.apiBaseUrl === "string") setApiBaseUrl(s.apiBaseUrl);
      const p = await companion.pair.status();
      setPaired(p.paired);
    })();
  }, []);

  const dockerOk = dockerState.phase === "ok";
  const cfOk = cfState.phase === "ok";
  const sysOk = dockerOk && cfOk;
  const repoOk = !!repoPath.trim();
  const canFinish = sysOk && repoOk && paired;

  async function runDockerCheck() {
    setDockerState({ phase: "checking" });
    const r = await companion.onboarding.checkDocker();
    setDockerState(
      r.installed
        ? { phase: "ok", version: r.version || "Docker found." }
        : { phase: "missing", message: r.message },
    );
  }

  async function runCfCheck() {
    setCfState({ phase: "checking" });
    const r = await companion.onboarding.checkCloudflared();
    setCfState(
      r.installed
        ? { phase: "ok", version: r.version || "cloudflared found." }
        : { phase: "missing", message: r.message },
    );
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
    // Persist any advanced override BEFORE pairing so the pair flow
    // hits the right Dev Hub.
    await companion.settings.set({
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
            Three quick steps to route the eSpace Dev Hub through your laptop.
            You only do this once.
          </p>
        </header>

        <Step
          n={1}
          title="System requirements"
          done={sysOk}
          locked={false}
          help="The companion runs the backend in Docker and exposes it via Cloudflare Tunnel. Both tools just need to be on PATH; the companion starts and stops them for you."
        >
          {/* Docker */}
          <div style={S.toolRow}>
            <span style={S.toolLabel}>Docker</span>
            {dockerState.phase === "idle" && (
              <Button onClick={runDockerCheck} variant="primary">
                Check
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
          </div>

          {/* cloudflared */}
          <div style={S.toolRow}>
            <span style={S.toolLabel}>cloudflared</span>
            {cfState.phase === "idle" && (
              <Button onClick={runCfCheck} variant="primary">
                Check
              </Button>
            )}
            {cfState.phase === "checking" && (
              <span style={S.muted}>Checking…</span>
            )}
            {cfState.phase === "ok" && (
              <span style={S.good}>✓ {cfState.version}</span>
            )}
            {cfState.phase === "missing" && (
              <div style={S.errorBlock}>
                <span style={S.bad}>{cfState.message}</span>
                <p style={S.installHint}>
                  Install with:{" "}
                  <code style={S.code}>{cfInstallHint.win}</code>{" "}
                  (Windows),{" "}
                  <code style={S.code}>{cfInstallHint.mac}</code>{" "}
                  (macOS), or{" "}
                  <code style={S.code}>{cfInstallHint.linux}</code>{" "}
                  (Linux). Restart this wizard after install.
                </p>
                <Button onClick={runCfCheck} variant="secondary">
                  Recheck
                </Button>
              </div>
            )}
          </div>
        </Step>

        <Step
          n={2}
          title="Repository folder"
          done={repoOk}
          locked={!sysOk}
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
            <Button onClick={chooseRepo} variant="primary" disabled={!sysOk}>
              Pick folder
            </Button>
          </div>
        </Step>

        <Step
          n={3}
          title="Pair this device"
          done={paired}
          locked={!repoOk}
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
            <Button onClick={startPair} variant="primary" disabled={!repoOk}>
              Pair this device
            </Button>
          )}
          {pairMessage && !paired && (
            <span style={S.muted}>{pairMessage}</span>
          )}

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
            />
            <p style={S.help}>
              Leave blank to use production. Override only when developing
              against a preview deploy or localhost.
            </p>
          </details>
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
  stepBody: { display: "flex", flexDirection: "column", gap: 12 },
  toolRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingBottom: 8,
    borderBottom: "1px solid var(--border)",
  },
  toolLabel: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  help: {
    margin: 0,
    fontSize: 12,
    color: "var(--muted)",
    lineHeight: 1.5,
  },
  installHint: {
    margin: 0,
    fontSize: 12,
    color: "var(--muted)",
    lineHeight: 1.6,
  },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 3,
    padding: "1px 4px",
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
