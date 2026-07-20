/**
 * Managed `cloudflared tunnel --url …` subprocess.
 *
 * Why this exists: named CF tunnels need a domain on the user's
 * Cloudflare account; TryCloudflare doesn't. By spawning cloudflared
 * directly with `--url`, the companion gets a free, ephemeral
 * `*.trycloudflare.com` hostname per session without ANY user
 * configuration (no token, no domain, no CF account).
 *
 * Lifecycle:
 *   start({ port })   spawns cloudflared, parses the hostname out of
 *                     its stderr log, resolves once we have it. The
 *                     process stays alive until stop() is called.
 *
 *   stop()            SIGTERMs the process; on Windows kills via
 *                     taskkill /T to also reap any helper processes
 *                     cloudflared spawned.
 *
 *   getState()        synchronous snapshot for the renderer.
 *
 *   subscribe(cb)     fired on state transitions so the renderer can
 *                     re-render without polling.
 *
 * Crash recovery: cloudflared occasionally dies after long sessions
 * (network blip, CF edge restart). On unexpected exit we transition
 * to "crashed" and auto-respawn up to MAX_RESTARTS times with
 * exponential backoff. The hostname WILL change after a respawn —
 * the caller (tunnel-register.ts) re-registers automatically when
 * `onHostname` fires.
 *
 * stdout vs stderr: cloudflared uses zerolog → all output goes to
 * stderr by default, INCLUDING the "Your quick Tunnel has been
 * created at …" banner. We listen on stderr.
 *
 * Detection: looks for cloudflared on PATH. We don't bundle the
 * binary yet (Phase 4-followup; see DISTRIBUTING.md TODO). For now
 * the install message in `check()` tells the user how to get it
 * (winget on Windows, brew on macOS, apt-get on Linux).
 */

import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { pushLog } from "./log-buffer.js";

const RESTART_BASE_MS = 2_000;
const RESTART_MAX_MS = 60_000;
const MAX_RESTARTS = 5;
const HOSTNAME_WAIT_MS = 30_000;

const TRYCLOUDFLARE_RE = /https?:\/\/([a-z0-9-]+\.trycloudflare\.com)/i;

/**
 * Ephemeral port for cloudflared's metrics + readiness endpoint. We
 * grab a free port from the OS at spawn time (rather than hardcoding)
 * so a stray cloudflared from a prior session — or any other dev
 * tool — doesn't collide on the same port. The probe in
 * tunnel-register reads this via `getMetricsPort()`.
 */
let metricsPort: number | null = null;
export function getMetricsPort(): number | null {
  return metricsPort;
}

/**
 * Ask the OS for a free TCP port bound to 127.0.0.1. Returns the
 * port number; the server is closed before resolving so cloudflared
 * can bind to it.
 *
 * Tiny race window between us closing + cloudflared binding — if
 * another process steals the port in that window, cloudflared will
 * crash on EADDRINUSE and our auto-restart logic re-attempts with a
 * fresh port. Acceptable.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("net.createServer().address() returned unexpected shape"));
      }
    });
  });
}

export interface TunnelSpawnState {
  /** Roughly tracks the lifecycle. */
  status: "idle" | "starting" | "running" | "crashed" | "stopped";
  /** The trycloudflare.com hostname (without scheme). Null until the
   *  process prints the banner; reassigned on respawn. */
  hostname: string | null;
  /** Local port being forwarded. */
  port: number | null;
  /** Number of times we've restarted after a crash. Reset on a
   *  successful start. */
  restarts: number;
  /** Surface for the UI when something's off. */
  lastError: string | null;
}

const INITIAL: TunnelSpawnState = {
  status: "idle",
  hostname: null,
  port: null,
  restarts: 0,
  lastError: null,
};

let state: TunnelSpawnState = INITIAL;
let child: ChildProcess | null = null;
let stopping = false;
let restartTimer: NodeJS.Timeout | null = null;
const listeners = new Set<() => void>();
let onHostnameChange: ((hostname: string) => void) | null = null;

function setState(patch: Partial<TunnelSpawnState>): void {
  state = { ...state, ...patch };
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function getState(): TunnelSpawnState {
  return { ...state };
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Register a callback fired EVERY time the hostname is (re)allocated.
 * The tunnel-register module sets this so a respawn after a CF edge
 * restart triggers a fresh /me/companion-tunnel POST automatically —
 * the user never has to touch the UI.
 */
export function onHostname(cb: (hostname: string) => void): void {
  onHostnameChange = cb;
}

/**
 * Probe for `cloudflared` on PATH. Mirrors node-check.ts's shape so
 * the wizard can show a uniform "missing-tool" panel for either.
 */
export function check(): Promise<{
  installed: boolean;
  version: string | null;
  message: string;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const settle = (r: {
      installed: boolean;
      version: string | null;
      message: string;
    }) => {
      if (resolved) return;
      resolved = true;
      resolve(r);
    };

    const proc = spawn("cloudflared", ["--version"], {
      shell: false,
      windowsHide: true,
    });
    proc.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      const isMissing =
        err.message.includes("ENOENT") ||
        (err as NodeJS.ErrnoException).code === "ENOENT";
      settle({
        installed: false,
        version: null,
        message: isMissing
          ? "cloudflared not found on PATH. Install via: winget install --id Cloudflare.cloudflared (Windows), brew install cloudflared (macOS), or apt install cloudflared (Linux)."
          : err.message,
      });
    });
    proc.on("close", (code) => {
      const out = stdout.trim() || stderr.trim();
      if (code === 0 && out) {
        settle({ installed: true, version: out.split("\n")[0]!, message: "" });
      } else {
        settle({
          installed: false,
          version: null,
          message:
            out ||
            `cloudflared --version exited with code ${code}.`,
        });
      }
    });
    setTimeout(() => {
      if (resolved) return;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      settle({
        installed: false,
        version: null,
        message: "cloudflared --version timed out.",
      });
    }, 5_000);
  });
}

interface StartOptions {
  port: number;
}

/**
 * Start cloudflared and resolve once we've parsed the trycloudflare
 * hostname from its log output. Rejects if the hostname doesn't
 * appear within HOSTNAME_WAIT_MS (network issue / bad cloudflared
 * version / firewall blocking outbound).
 *
 * Idempotent — calling start() while running stop()s first, then
 * starts fresh on the (possibly different) port.
 */
export async function start({ port }: StartOptions): Promise<TunnelSpawnState> {
  if (child) {
    await stop();
  }
  stopping = false;

  setState({
    status: "starting",
    hostname: null,
    port,
    lastError: null,
    // Don't reset `restarts` here — that's done after we observe a
    // successful "running" transition below.
  });

  // Grab a free port for cloudflared's metrics/readiness endpoint
  // BEFORE entering the Promise executor (which can't be async).
  // Hardcoding (we tried 20241) collides with prior cloudflared
  // sessions still holding the port + with any other dev tool that
  // grabbed it. Pre-allocating via the OS is race-free except for a
  // microscopic window before cloudflared binds — caught by our
  // auto-restart loop if it ever matters.
  try {
    metricsPort = await findFreePort();
  } catch (err) {
    const msg =
      err instanceof Error
        ? `couldn't find a free metrics port: ${err.message}`
        : "couldn't find a free metrics port";
    pushLog(`[tunnel-spawn] ${msg}`);
    setState({ status: "crashed", lastError: msg });
    throw new Error(msg);
  }

  return new Promise<TunnelSpawnState>((resolve, reject) => {
    let resolved = false;
    let hostnameSeen = false;

    // The hostname-wait timer rejects start() if cloudflared never
    // prints the banner. We DON'T kill the process on this path
    // because the user might want logs for debugging.
    const waitTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      const msg = `cloudflared didn't allocate a hostname within ${
        HOSTNAME_WAIT_MS / 1000
      }s. Network blocked? Try running it manually: cloudflared tunnel --url http://localhost:${port}`;
      setState({ status: "crashed", lastError: msg });
      reject(new Error(msg));
    }, HOSTNAME_WAIT_MS);

    pushLog(
      `[tunnel-spawn] starting: cloudflared tunnel --protocol http2 --metrics 127.0.0.1:${metricsPort} --url http://localhost:${port}`,
    );

    try {
      child = spawn(
        "cloudflared",
        [
          "tunnel",
          "--no-autoupdate",
          // Force HTTP/2 instead of cloudflared's default QUIC. QUIC
          // (UDP-based) is routinely blocked by corporate VPNs —
          // FortiClient in particular drops the handshake, resulting
          // in `Failed to dial a quic connection error="failed to
          // dial to edge with quic: timeout: handshake did not
          // complete in time"` and indefinite retries that never
          // fall back. HTTP/2 (TCP/443) goes through the same TLS
          // pipes regular HTTPS uses, which corporate networks
          // basically always allow.
          //
          // The trade-off: HTTP/2 is fractionally slower than QUIC
          // for our use case (no 0-RTT, no multipath). Negligible
          // for a low-volume management API; well worth the
          // reliability gain.
          "--protocol",
          "http2",
          // Bind cloudflared's metrics + readiness endpoint to the
          // free port we just claimed. tunnel-register reads the same
          // value via getMetricsPort() to know where to probe.
          "--metrics",
          `127.0.0.1:${metricsPort}`,
          "--url",
          `http://localhost:${port}`,
        ],
        {
          // shell:true on Windows so cmd.exe resolves cloudflared's
          // location via PATHEXT — Electron's main process PATH can
          // drift from the user's interactive shell PATH (especially
          // when cloudflared was installed via winget after Electron
          // launched), and shell:false won't find a bare `cloudflared`
          // without explicit `.exe`. shell:true is safe here because
          // none of our args contain spaces or shell meta-characters.
          shell: process.platform === "win32",
          windowsHide: true,
        },
      );
    } catch (err) {
      clearTimeout(waitTimer);
      resolved = true;
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(`[tunnel-spawn] spawn threw: ${msg}`);
      setState({ status: "crashed", lastError: msg });
      reject(new Error(msg));
      return;
    }

    const handleLine = (line: string) => {
      const m = TRYCLOUDFLARE_RE.exec(line);
      if (!m) return;
      const hostname = m[1]!.toLowerCase();
      if (state.hostname === hostname) return;
      hostnameSeen = true;
      clearTimeout(waitTimer);
      setState({
        status: "running",
        hostname,
        restarts: 0,
        lastError: null,
      });
      // Fire the registered hostname callback (tunnel-register hook).
      try {
        onHostnameChange?.(hostname);
      } catch {
        /* ignore */
      }
      if (!resolved) {
        resolved = true;
        resolve({ ...state });
      }
    };

    // Pipe EVERY line from cloudflared into the shared log buffer so
    // the renderer's Logs panel can show what's happening. Previously
    // these lines were swallowed by the closure handler and the user
    // had no way to see why spawn failed.
    //
    // cloudflared writes the banner to STDERR (zerolog default). We
    // listen on both streams defensively in case a future version
    // changes that.
    const consume = (stream: "out" | "err") => (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        pushLog(`[cloudflared${stream === "err" ? "/err" : ""}] ${line}`);
        handleLine(line);
      }
    };
    child.stderr?.on("data", consume("err"));
    child.stdout?.on("data", consume("out"));

    child.on("error", (err) => {
      clearTimeout(waitTimer);
      const isMissing =
        err.message.includes("ENOENT") ||
        (err as NodeJS.ErrnoException).code === "ENOENT";
      const msg = isMissing
        ? "cloudflared not found on PATH. Install via: winget install --id Cloudflare.cloudflared (Windows), brew install cloudflared (macOS)."
        : err.message;
      pushLog(`[tunnel-spawn] child error: ${msg}`);
      setState({ status: "crashed", lastError: msg });
      if (!resolved) {
        resolved = true;
        reject(new Error(msg));
      }
    });

    child.on("close", (code) => {
      const wasRunning = state.status === "running";
      child = null;
      pushLog(
        `[tunnel-spawn] cloudflared exited (code=${code}, wasRunning=${wasRunning}, hostnameSeen=${hostnameSeen})`,
      );
      if (stopping) {
        setState({ status: "stopped", hostname: null });
        return;
      }
      // Unexpected exit. Auto-respawn if we've seen at least one
      // successful run and we haven't exhausted restart attempts.
      if (wasRunning && hostnameSeen && state.restarts < MAX_RESTARTS) {
        const delay = Math.min(
          RESTART_BASE_MS * 2 ** state.restarts,
          RESTART_MAX_MS,
        );
        const msg = `cloudflared exited with code ${code} — restarting in ${
          delay / 1000
        }s (attempt ${state.restarts + 1}/${MAX_RESTARTS})…`;
        pushLog(`[tunnel-spawn] ${msg}`);
        setState({
          status: "crashed",
          hostname: null,
          restarts: state.restarts + 1,
          lastError: msg,
        });
        restartTimer = setTimeout(() => {
          restartTimer = null;
          void start({ port }).catch(() => {
            /* state already reflects the error */
          });
        }, delay);
      } else {
        const msg = wasRunning
          ? `cloudflared restart budget exhausted (${MAX_RESTARTS} attempts). Stop + start backend to retry.`
          : `cloudflared exited with code ${code} before allocating a hostname.`;
        pushLog(`[tunnel-spawn] ${msg}`);
        setState({
          status: "crashed",
          hostname: null,
          lastError: msg,
        });
      }
    });
  });
}

/** Cleanly stop the subprocess. Idempotent. */
export async function stop(): Promise<void> {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (!child) {
    setState({ status: "stopped", hostname: null });
    return;
  }
  const proc = child;
  child = null;
  await new Promise<void>((resolve) => {
    const cleanup = () => resolve();
    proc.once("close", cleanup);
    try {
      if (process.platform === "win32") {
        // SIGTERM doesn't propagate cleanly on Windows for subprocesses
        // that spawn helpers (cloudflared sometimes does). Use
        // taskkill /T to reap the whole tree.
        spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
          shell: false,
          windowsHide: true,
        }).on("close", () => {
          /* close event on `proc` settles the promise */
        });
      } else {
        proc.kill("SIGTERM");
        // Hard-kill after 5s if SIGTERM didn't take.
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }, 5_000);
      }
    } catch (err) {
      // If the kill itself throws, fall back to just resolving;
      // process is presumably already dead.
      // eslint-disable-next-line no-console
      console.warn(
        "[tunnel-spawn] kill failed:",
        err instanceof Error ? err.message : String(err),
      );
      cleanup();
    }
  });
  setState({ status: "stopped", hostname: null });
}
