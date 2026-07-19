/**
 * Electron main process — eSpace Dev Hub companion.
 *
 * Responsibilities (Phase 1):
 *   - Single window UI for the user
 *   - System tray icon with quick-action menu (window visible / quit)
 *   - IPC bridge exposing Docker compose control + API healthcheck
 *   - Persisted settings via electron-store (CF tunnel token, last
 *     known repo path, auto-start on login)
 *
 * NOT in Phase 1:
 *   - FortiClient automation (Phase 2)
 *   - CF tunnel auto-provisioning (Phase 3)
 *   - Per-user API_ORIGIN registration (Phase 3)
 *   - Auto-update (Phase 4)
 *
 * The companion app's job is to make running the eSpace Dev Hub
 * backend container a one-click affair for Crealogix devs whose
 * laptops are the only network-route to git.bcn.crealogix.net. This
 * Phase 1 wires the controls and surfaces; future phases automate
 * the steps the user still does by hand (connecting VPN, registering
 * the tunnel with the server).
 */

import { app, BrowserWindow, Tray, Menu, dialog, ipcMain, shell, nativeImage } from "electron";
import path from "node:path";
import { startBackend, stopBackend, backendStatus, tailLogs } from "./docker";
import { pingApi } from "./health";
import { settings } from "./settings";
import * as vpn from "./vpn";
import * as keychain from "./keychain";
import * as pair from "./pair";
import * as tunnel from "./tunnel-register";
import * as tunnelSpawn from "./tunnel-spawn";
import { checkDocker } from "./docker-check";
import { downloadAndLaunchDockerInstaller } from "./docker-install";
import { installCloudflared } from "./cloudflared-install";
import { cloneAndInstall, getCloneState, resetCloneState } from "./repo-clone";
import { initAutoUpdater } from "./auto-update";

// __dirname is available natively in CommonJS — no fileURLToPath
// gymnastics needed. Electron's main process is CJS by default; we
// keep that to avoid the ESM-in-Electron rough edges still present
// in v33.
const isDev = process.env.NODE_ENV === "development";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Single-instance guard — without this, double-clicking the tray
// icon or the desktop shortcut would spawn parallel Electron
// processes, each trying to own port 4000 / the tunnel.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  // Someone tried to launch a second instance — focus the existing
  // window instead of spawning a new one.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 540,
    minHeight: 420,
    title: "eSpace Dev Hub — Companion",
    backgroundColor: "#0e1116",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node access to call the IPC bridge
    },
  });

  // Window starts hidden + reveals once content is ready — avoids
  // the blank-white flash on Windows.
  win.once("ready-to-show", () => win.show());

  // Closing the window minimizes to tray on Windows/Linux — the app
  // keeps running. macOS gets the classic "click dock icon to bring
  // back" behavior via the activate event below.
  win.on("close", (e) => {
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  return win;
}

function createTray(): Tray {
  // Tray icon — a simple 16x16 PNG. Falling back to an empty native
  // image if the asset is missing keeps the app from crashing on a
  // fresh checkout where bundling hasn't packaged the icons yet.
  const iconPath = path.join(__dirname, "..", "..", "assets", "tray.png");
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  const t = new Tray(icon);
  t.setToolTip("eSpace Dev Hub Companion");

  const rebuildMenu = () => {
    const status = backendStatus();
    const menu = Menu.buildFromTemplate([
      {
        label: `Backend: ${status.running ? "running" : "stopped"}`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Open companion window",
        click: () => {
          if (!mainWindow) mainWindow = createWindow();
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: status.running ? "Stop backend" : "Start backend",
        click: async () => {
          if (status.running) {
            await stopBackend();
          } else {
            await startBackend();
          }
          rebuildMenu();
        },
      },
      { type: "separator" },
      {
        label: "Quit companion",
        click: () => {
          (app as unknown as { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        },
      },
    ]);
    t.setContextMenu(menu);
  };
  rebuildMenu();

  // Refresh the menu's "running/stopped" label every 5s.
  setInterval(rebuildMenu, 5_000);

  // Single-click on Windows opens the window. macOS uses the menu
  // bar item differently (right-click to see menu, left-click also
  // shows it by default).
  t.on("click", () => {
    if (!mainWindow) mainWindow = createWindow();
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });

  return t;
}

// ─── IPC bridge ─────────────────────────────────────────────────────
// All preload-exposed channels listed in one place so the public
// surface is auditable. Each handler returns a serialisable result
// (or throws — Electron forwards thrown errors back to the renderer).

ipcMain.handle("backend:start", async () => {
  // Phase 2c — if the user has the auto-connect setting on AND the
  // VPN is currently down, attempt to bring it up first. The Docker
  // stack itself doesn't need the VPN to start; what NEEDS the VPN
  // is the upstream calls the api makes once requests arrive (e.g.
  // git.bcn.crealogix.net fetches). But pre-flighting here gives
  // cleaner UX — by the time "Backend: running" lights up, the
  // user can immediately use the website.
  if (settings.get<boolean>("vpnAutoConnectOnStart", false)) {
    const s = await vpn.status();
    if (!s.connected) {
      await vpn.connect();
      // Don't block on VPN completing — the actual connection can
      // take 5–20s and FortiClient's GUI flow may need user input.
      // We start Docker in parallel; the user's first integration
      // call may bounce if the VPN isn't up yet, but that's a
      // recoverable state (retry the request after VPN connects).
    }
  }
  const result = await startBackend();

  // Phase 3d + auto-tunnel — after Docker is up:
  //   1. spawn cloudflared (TryCloudflare); when it allocates the
  //      *.trycloudflare.com hostname, the onHostname callback wired
  //      below auto-fires tunnel.start(hostname) to register with the
  //      Dev Hub.
  //   2. tunnel.start runs the heartbeat that keeps lastSeenAt fresh.
  //
  // Best-effort end-to-end: a missing cloudflared binary or unpaired
  // companion is surfaced via tunnel-spawn.getState() / tunnel.getState()
  // — but the backend itself still starts cleanly so the user can
  // pair / install cloudflared and retry.
  if (
    result.ok &&
    settings.get<boolean>("tunnelAutoRegister", true) &&
    pair.status().paired
  ) {
    void tunnelSpawn.start({ port: 4000 }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(
        "[main] tunnel-spawn failed:",
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  return result;
});

ipcMain.handle("vpn:status", async () => {
  return vpn.status();
});

ipcMain.handle("vpn:connect", async () => {
  return vpn.connect();
});

ipcMain.handle("vpn:disconnect", async () => {
  return vpn.disconnect();
});

ipcMain.handle("vpn:discover-client", async () => {
  return vpn.discoverClient();
});

ipcMain.handle("credentials:has", async (_event, key: string) => {
  if (typeof key !== "string") throw new Error("key must be a string");
  return { keychainAvailable: keychain.isAvailable(), set: keychain.has(key) };
});

ipcMain.handle(
  "credentials:set",
  async (_event, { key, value }: { key: string; value: string }) => {
    if (typeof key !== "string" || typeof value !== "string") {
      throw new Error("key + value must be strings");
    }
    keychain.set(key, value);
    return { ok: true };
  },
);

ipcMain.handle("credentials:clear", async (_event, key: string) => {
  if (typeof key !== "string") throw new Error("key must be a string");
  keychain.clear(key);
  return { ok: true };
});

ipcMain.handle("backend:stop", async () => {
  // Phase 3d + auto-tunnel — teardown order matters:
  //   1. clear the tunnel registration (so the Dev Hub catch-all stops
  //      routing to a hostname we're about to take down)
  //   2. kill the cloudflared subprocess (severs the public hostname)
  //   3. stop Docker
  // Reversing 1-2 would leave the Dev Hub briefly routing to a dead
  // cloudflared, surfacing "companion_unreachable" toasts to anyone
  // mid-request.
  await tunnel.stop();
  await tunnelSpawn.stop();
  return stopBackend();
});

ipcMain.handle("tunnel:spawn-state", async () => {
  return tunnelSpawn.getState();
});

// ─── companion pairing IPC ───────────────────────────────────────────
ipcMain.handle("companion:status", async () => {
  // Include tunnel-spawn state so the renderer can surface spawn-side
  // errors (ENOENT on cloudflared, bad CF edge, etc.) instead of just
  // showing "Tunnel: off" with no clue why.
  return {
    ...pair.status(),
    tunnel: tunnel.getState(),
    spawn: tunnelSpawn.getState(),
  };
});

ipcMain.handle("companion:pair", async () => {
  return pair.pair();
});

ipcMain.handle("companion:pair-cancel", async () => {
  pair.cancelPairing();
  return { ok: true };
});

ipcMain.handle("companion:unpair", async () => {
  // Local-only forget. Devices-UI revoke (Phase 3e) is a separate
  // path that hits DELETE /api/v1/companion/devices/:id with the
  // browser session.
  await tunnel.stop();
  pair.unpair();
  return { ok: true };
});

ipcMain.handle("tunnel:register", async () => {
  // Manual register from the main UI. Use whatever hostname cloudflared
  // has currently allocated; if spawn isn't running, surface that.
  const spawnState = tunnelSpawn.getState();
  if (!spawnState.hostname) {
    return {
      ok: false as const,
      reason: "missing_hostname" as const,
      message:
        "No tunnel hostname allocated yet. Start the backend first — cloudflared launches and assigns a hostname automatically.",
    };
  }
  return tunnel.start(spawnState.hostname);
});

ipcMain.handle("tunnel:clear", async () => {
  await tunnel.stop();
  return { ok: true };
});

ipcMain.handle("backend:status", async () => {
  return backendStatus();
});

ipcMain.handle("backend:logs", async (_event, { lines = 100 } = {}) => {
  return tailLogs(lines);
});

ipcMain.handle("api:ping", async () => {
  return pingApi();
});

ipcMain.handle("settings:get", async () => {
  return settings.all();
});

ipcMain.handle("settings:set", async (_event, patch: Record<string, unknown>) => {
  settings.patch(patch);
  return settings.all();
});

ipcMain.handle("shell:open-external", async (_event, url: string) => {
  if (typeof url !== "string") throw new Error("url must be a string");
  // Defensive — only allow http(s) URLs out of the companion. We
  // don't want a renderer compromise to be able to launch arbitrary
  // protocol handlers on the user's machine.
  if (!/^https?:\/\//.test(url)) {
    throw new Error("only http(s) URLs are allowed");
  }
  await shell.openExternal(url);
});

// ─── onboarding wizard IPC ───────────────────────────────────────────
// The first-run wizard needs to verify Docker is on PATH + let the
// user pick their repo path via a native folder picker. Both are
// scoped to main because the renderer has no file-system access.

ipcMain.handle("docker:check", async () => {
  return checkDocker();
});

ipcMain.handle("cloudflared:check", async () => {
  return tunnelSpawn.check();
});

ipcMain.handle("docker:install", async () => {
  return downloadAndLaunchDockerInstaller();
});

ipcMain.handle("cloudflared:install", async () => {
  return installCloudflared();
});

ipcMain.handle(
  "repo:clone-start",
  async (_event, { parentDir, repoUrl }: { parentDir: string; repoUrl?: string }) => {
    if (typeof parentDir !== "string" || !parentDir.trim()) {
      throw new Error("parentDir must be a non-empty string");
    }
    resetCloneState();
    // Fire-and-forget — the renderer polls repo:clone-status for
    // progress instead of awaiting this handler, since the clone +
    // install can take well over a minute.
    void cloneAndInstall(parentDir, repoUrl).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(
        "[main] cloneAndInstall failed:",
        err instanceof Error ? err.message : String(err),
      );
    });
    return { ok: true };
  },
);

ipcMain.handle("repo:clone-status", async () => {
  return getCloneState();
});

ipcMain.handle("dialog:choose-directory", async (_event, title?: string) => {
  // returnFocus is the only place we care about the window-handle
  // origin — falls back to undefined cleanly if no window is open.
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const opts: Electron.OpenDialogOptions = {
    title: typeof title === "string" && title.trim() ? title : "Choose a folder",
    properties: ["openDirectory"],
  };
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
});

// ─── lifecycle ──────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Apply the persisted auto-start setting on app launch. The user
  // can toggle this from the settings UI later.
  if (settings.get("autoStartAtLogin", false)) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  mainWindow = createWindow();
  tray = createTray();
  void tray; // keep the ref alive — tray instances are GC'd otherwise

  // Phase 4 — auto-update polling. Background; no-op in dev / when
  // unpackaged. See apps/desktop/src/main/auto-update.ts.
  initAutoUpdater();

  // Wire tunnel-spawn → tunnel-register: every time cloudflared
  // allocates (or re-allocates after a respawn) a hostname, register
  // it with the Dev Hub. tunnel.start() is idempotent, so calling it
  // with a fresh hostname cleanly replaces the prior registration.
  tunnelSpawn.onHostname((hostname) => {
    void tunnel.start(hostname).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(
        "[main] tunnel.start failed after hostname allocation:",
        err instanceof Error ? err.message : String(err),
      );
    });
  });
});

app.on("activate", () => {
  // macOS — clicking the dock icon with no windows open re-creates one.
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on("window-all-closed", () => {
  // Default Electron quits on window-close on Windows/Linux. We
  // explicitly DON'T — the tray keeps running. macOS already keeps
  // the app alive when all windows close.
  // (Quit only via the tray "Quit" menu or `app.isQuitting = true`.)
});

app.on("before-quit", () => {
  // Best-effort cleanup, ordered like backend:stop:
  //   1. clear Dev Hub registration
  //   2. kill cloudflared
  //   3. stop Docker
  // We don't await any of these — quit shouldn't stall waiting on
  // network calls or subprocess teardown.
  void tunnel.stop();
  void tunnelSpawn.stop();
  void stopBackend({ silent: true });
});
