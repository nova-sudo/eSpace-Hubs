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
 * System requirements are one-click, too — "Install" shells out to the
 * platform package manager for cloudflared, or downloads + launches
 * Docker Desktop's own installer. Neither is silent (Docker in
 * particular needs an admin-elevated GUI installer), so both surface
 * a clear next step instead of a bare copy-paste command.
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
      installDocker: () => Promise<{ ok: boolean; message: string }>;
      installCloudflared: () => Promise<{ ok: boolean; message: string }>;
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
  | { phase: "installing" }
  | { phase: "ok"; version: string }
  | { phase: "missing"; message: string }
  | { phase: "install-launched"; message: string };

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

  async function runDockerInstall() {
    setDockerState({ phase: "installing" });
    const r = await companion.onboarding.installDocker();
    setDockerState(
      r.ok
        ? { phase: "install-launched", message: r.message }
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

  async function runCfInstall() {
    setCfState({ phase: "installing" });
    const r = await companion.onboarding.installCloudflared();
    if (!r.ok) {
      setCfState({ phase: "missing", message: r.message });
      return;
    }
    // cloudflared installs onto PATH immediately (unlike Docker, no
    // GUI installer to wait on) — recheck right away to confirm. A
    // freshly-installed binary's directory can still miss this
    // process's PATH on Windows until the companion restarts, so a
    // failed recheck here isn't necessarily wrong.
    const check = await companion.onboarding.checkCloudflared();
    setCfState(
      check.installed
        ? { phase: "ok", version: check.version || "cloudflared found." }
        : {
            phase: "missing",
            message:
              "Installed, but not visible on PATH yet — restart the companion app and recheck.",
          },
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
          <div style={S.eyebrow}>
            <span style={S.eyebrowDot} aria-hidden="true" />
            <span style={S.eyebrowLabel}>Setup</span>
          </div>
          <h1 style={S.title}>
            Welcome to the <em style={S.titleAccent}>companion</em>.
          </h1>
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
          help="The companion runs the backend in Docker and exposes it via Cloudflare Tunnel. Install both below, or let the companion do it — it starts and stops them for you afterward."
        >
          <ToolRow
            glyph="DK"
            label="Docker"
            state={dockerState}
            onCheck={runDockerCheck}
            onInstall={runDockerInstall}
            installLabel="Download & install"
          />
          <ToolRow
            glyph="CF"
            label="cloudflared"
            state={cfState}
            onCheck={runCfCheck}
            onInstall={runCfInstall}
            installLabel="Install"
          >
            {cfState.phase === "missing" && (
              <p style={S.installHint}>
                Or run it yourself:{" "}
                <code style={S.code}>{cfInstallHint.win}</code> (Windows),{" "}
                <code style={S.code}>{cfInstallHint.mac}</code> (macOS), or{" "}
                <code style={S.code}>{cfInstallHint.linux}</code> (Linux).
              </p>
            )}
          </ToolRow>
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
            <StatusPill tone="ok">Paired. You're ready to go.</StatusPill>
          ) : pairBusy ? (
            <div style={S.row}>
              <span style={S.muted}>
                <span className="companion-spinner" style={S.spinnerInline} />
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
            background: done ? "var(--good)" : "var(--panel-2)",
            color: done ? "#050505" : "var(--muted-fg)",
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

/** A colored, pill-shaped status chip — mirrors apps/web's Pill tones. */
function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "bad" | "accent" | "muted";
  children: React.ReactNode;
}) {
  return <span style={{ ...S.pill, ...PILL_TONES[tone] }}>{children}</span>;
}

/** One system-requirement row: glyph badge, label, live status, actions. */
function ToolRow({
  glyph,
  label,
  state,
  onCheck,
  onInstall,
  installLabel,
  children,
}: {
  glyph: string;
  label: string;
  state: ToolState;
  onCheck: () => void;
  onInstall: () => void;
  installLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={S.toolRow}>
      <div style={S.toolRowHead}>
        <span style={S.toolGlyph}>{glyph}</span>
        <span style={S.toolLabel}>{label}</span>
        <span style={S.toolStatus}>
          {state.phase === "idle" && <StatusPill tone="muted">Not checked</StatusPill>}
          {state.phase === "checking" && (
            <StatusPill tone="accent">
              <span className="companion-spinner" style={S.spinnerInline} />
              Checking
            </StatusPill>
          )}
          {state.phase === "installing" && (
            <StatusPill tone="accent">
              <span className="companion-spinner" style={S.spinnerInline} />
              Installing
            </StatusPill>
          )}
          {state.phase === "ok" && <StatusPill tone="ok">✓ Installed</StatusPill>}
          {state.phase === "missing" && <StatusPill tone="bad">Not found</StatusPill>}
          {state.phase === "install-launched" && (
            <StatusPill tone="accent">Installer running</StatusPill>
          )}
        </span>
      </div>

      {state.phase === "ok" && <p style={S.toolDetail}>{state.version}</p>}
      {state.phase === "missing" && <p style={S.toolDetailBad}>{state.message}</p>}
      {state.phase === "install-launched" && (
        <p style={S.toolDetail}>{state.message}</p>
      )}

      <div style={S.toolActions}>
        {state.phase === "idle" && (
          <Button onClick={onCheck} variant="primary">
            Check
          </Button>
        )}
        {(state.phase === "missing" || state.phase === "install-launched") && (
          <>
            {state.phase === "missing" && (
              <Button onClick={onInstall} variant="primary">
                {installLabel}
              </Button>
            )}
            <Button onClick={onCheck} variant="secondary">
              Recheck
            </Button>
          </>
        )}
      </div>

      {children}
    </div>
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
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...S.btn,
        ...(variant === "primary" ? S.btnPrimary : S.btnSecondary),
        ...(hover && !disabled
          ? variant === "primary"
            ? S.btnPrimaryHover
            : S.btnSecondaryHover
          : null),
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ─────────────────── styles ─────────────────── */

const PILL_TONES: Record<"ok" | "bad" | "accent" | "muted", React.CSSProperties> = {
  ok: { background: "color-mix(in srgb, var(--good) 16%, transparent)", color: "var(--good)" },
  bad: { background: "color-mix(in srgb, var(--bad) 16%, transparent)", color: "var(--bad)" },
  accent: { background: "var(--accent-dim)", color: "var(--accent)" },
  muted: { background: "color-mix(in srgb, var(--fg) 6%, transparent)", color: "var(--muted-fg)" },
};

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(5, 5, 5, 0.94)",
    backdropFilter: "blur(8px)",
    backgroundImage: "radial-gradient(var(--dot-dim) 1px, transparent 1px)",
    backgroundSize: "13px 13px",
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
  eyebrow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  eyebrowDot: {
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "var(--radius-pill)",
    background: "var(--accent)",
  },
  eyebrowLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: 10.5,
    fontWeight: 700,
    color: "var(--muted-fg)",
    textTransform: "uppercase",
    letterSpacing: "1.4px",
  },
  title: {
    margin: 0,
    fontFamily: "var(--font-dot)",
    fontWeight: 900,
    fontSize: 32,
    lineHeight: 1.05,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  },
  titleAccent: { fontStyle: "normal", color: "var(--accent)" },
  subtitle: {
    margin: "10px 0 0 0",
    color: "var(--muted-fg)",
    fontSize: 13,
    lineHeight: 1.55,
    maxWidth: 440,
  },
  step: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-tile)",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset",
  },
  stepHead: { display: "flex", alignItems: "center", gap: 10 },
  stepNum: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 700,
    flex: "none",
  },
  stepTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    fontFamily: "var(--font-dot)",
  },
  stepBody: { display: "flex", flexDirection: "column", gap: 12 },
  toolRow: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px 0",
    borderBottom: "1px dashed var(--border)",
  },
  toolRowHead: { display: "flex", alignItems: "center", gap: 10 },
  toolGlyph: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: "var(--radius-sub)",
    background: "var(--accent-dim)",
    color: "var(--accent)",
    fontFamily: "var(--font-mono)",
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.3px",
    flex: "none",
  },
  toolLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--fg)",
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    flex: 1,
  },
  toolStatus: { flex: "none" },
  toolDetail: {
    margin: "0 0 0 36px",
    fontSize: 11.5,
    color: "var(--muted-fg)",
    lineHeight: 1.5,
    fontFamily: "var(--font-mono)",
  },
  toolDetailBad: {
    margin: "0 0 0 36px",
    fontSize: 11.5,
    color: "var(--bad)",
    lineHeight: 1.5,
  },
  toolActions: { display: "flex", gap: 8, marginLeft: 36 },
  help: {
    margin: 0,
    fontSize: 12,
    color: "var(--muted-fg)",
    lineHeight: 1.55,
  },
  installHint: {
    margin: "0 0 0 36px",
    fontSize: 11.5,
    color: "var(--dim-fg)",
    lineHeight: 1.6,
  },
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    background: "var(--panel-2)",
    border: "1px solid var(--border-strong)",
    borderRadius: 3,
    padding: "1px 5px",
  },
  row: { display: "flex", gap: 8, alignItems: "center" },
  input: {
    background: "var(--panel-2)",
    color: "var(--fg)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sub)",
    padding: "8px 10px",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
  },
  details: { fontSize: 12, color: "var(--muted-fg)" },
  detailsSummary: {
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
  },
  btn: {
    borderRadius: "var(--radius-sub)",
    padding: "8px 14px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    fontFamily: "var(--font-mono)",
    transition: "background 0.12s ease, border-color 0.12s ease, transform 0.12s ease",
  },
  btnPrimary: {
    background: "var(--accent)",
    color: "var(--accent-on)",
    border: "1px solid var(--accent)",
  },
  btnPrimaryHover: {
    transform: "translateY(-1px)",
    boxShadow: "0 4px 12px var(--accent-dim)",
  },
  btnSecondary: {
    background: "transparent",
    color: "var(--fg)",
    border: "1px solid var(--border-strong)",
  },
  btnSecondaryHover: {
    borderColor: "var(--accent)",
    color: "var(--accent)",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    whiteSpace: "nowrap",
  },
  spinnerInline: { marginRight: 6, verticalAlign: "-1.5px" },
  good: { fontSize: 12, color: "var(--good)" },
  bad: { fontSize: 12, color: "var(--bad)" },
  muted: {
    fontSize: 12,
    color: "var(--muted-fg)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  errorBlock: { display: "flex", flexDirection: "column", gap: 6 },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
  },
};
