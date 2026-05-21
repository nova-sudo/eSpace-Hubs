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

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } from "electron";
import path from "node:path";
import { startBackend, stopBackend, backendStatus, tailLogs } from "./docker";
import { pingApi } from "./health";
import { settings } from "./settings";

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
  return startBackend();
});

ipcMain.handle("backend:stop", async () => {
  return stopBackend();
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
  // Best-effort: stop the backend container when the user quits the
  // companion. Without this, `docker compose up -d` would leave a
  // container running in the background even after the companion is
  // gone — surprising for the user.
  void stopBackend({ silent: true });
});
