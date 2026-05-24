/**
 * Auto-update wiring.
 *
 * Strategy: `electron-updater` polls the configured publish target
 * (GitHub Releases — see electron-builder.yml) for a newer
 * `latest{,-mac,-linux}.yml` manifest. When one's found it downloads
 * the diff in the background and surfaces a native OS notification
 * telling the user "restart to install."
 *
 * Why we don't gate startup on update-check
 * ─────────────────────────────────────────
 * The companion's whole job is to be in the system tray, always
 * ready. A network blip blocking startup would be a regression on
 * the Phase 1 promise. We fire-and-forget on a 30-second delay so
 * the initial window paint + tray icon win the race; the update
 * check then runs in the background.
 *
 * Why we don't auto-restart
 * ─────────────────────────
 * Users might be mid-pairing / mid-backend-start. We let
 * `electron-updater` show its native prompt and the user picks when
 * to restart. The default behavior (`checkForUpdatesAndNotify`) does
 * exactly this — no UI work needed on our side.
 *
 * Disabling auto-update
 * ─────────────────────
 * In dev mode (`NODE_ENV !== "production"`), or when explicitly
 * disabled by setting `DISABLE_AUTO_UPDATE=1`, this module is a
 * no-op. The dev path is critical — `electron-updater` reads the
 * app's version from package.json AND requires the app to be a
 * packaged build; unpackaged Electron always reports a useless
 * "1.0.0" version that would constantly fail the version compare.
 */

import { app } from "electron";

const INITIAL_CHECK_DELAY_MS = 30_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

export function initAutoUpdater(): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[auto-update] skipping — dev build");
    return;
  }
  if (process.env.DISABLE_AUTO_UPDATE === "1") {
    // eslint-disable-next-line no-console
    console.log("[auto-update] disabled via DISABLE_AUTO_UPDATE=1");
    return;
  }
  if (!app.isPackaged) {
    // Same reason as the NODE_ENV check — `electron-updater` only
    // works in packaged builds. Belt-and-suspenders.
    // eslint-disable-next-line no-console
    console.log("[auto-update] skipping — app is not packaged");
    return;
  }

  // Dynamic require so the dev path never has to resolve the module.
  // (electron-updater pulls in app-builder-bin which has native
  // platform-specific binaries we don't want loaded during `npm
  // run dev`.)
  let updater: typeof import("electron-updater") | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    updater = require("electron-updater");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auto-update] electron-updater unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return;
  }
  if (!updater) return;

  const { autoUpdater } = updater;

  // electron-updater emits noisy `debug` logs by default — pin them
  // to warn+ so the console stays readable in production.
  autoUpdater.logger = {
    info: () => {},
    warn: (msg: unknown) => console.warn("[auto-update]", msg),
    error: (msg: unknown) => console.error("[auto-update]", msg),
    debug: () => {},
  } as never;

  autoUpdater.on("error", (err: Error) => {
    console.warn("[auto-update] error:", err.message);
  });
  autoUpdater.on("update-available", (info: { version: string }) => {
    // eslint-disable-next-line no-console
    console.log("[auto-update] update available:", info.version);
  });
  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    // eslint-disable-next-line no-console
    console.log(
      "[auto-update] update downloaded:",
      info.version,
      "— prompting on next restart",
    );
  });

  const scheduleCheck = () => {
    void autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.warn(
        "[auto-update] check failed:",
        err instanceof Error ? err.message : String(err),
      );
    });
  };

  // Initial delayed check + periodic recheck while running.
  setTimeout(scheduleCheck, INITIAL_CHECK_DELAY_MS);
  setInterval(scheduleCheck, RECHECK_INTERVAL_MS);
}
