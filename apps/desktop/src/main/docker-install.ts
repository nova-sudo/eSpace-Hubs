/**
 * One-click "download & launch the official Docker Desktop installer"
 * for the onboarding wizard.
 *
 * We deliberately DON'T try to silently install Docker Desktop — its
 * installer requires admin elevation (UAC on Windows, an authorization
 * prompt on macOS) and can require a logout/restart for WSL2 on
 * Windows. Silently running an elevated installer with no user-visible
 * consent step would be a bad idea even if it were technically
 * possible. The best safe automation is: fetch the right installer for
 * this OS/arch and hand it to the OS to run, so the user never has to
 * find the download page themselves — they still see (and click
 * through) Docker's own installer and admin prompt.
 *
 * Linux has no single universal Docker Desktop package (separate .deb
 * builds per distro, some distros unsupported) — we open Docker's own
 * install picker instead of guessing wrong.
 */

import { app, shell } from "electron";
import { createWriteStream } from "node:fs";
import path from "node:path";
import https from "node:https";
import { pushLog } from "./docker.js";

export interface InstallResult {
  ok: boolean;
  message: string;
}

const INSTALLER_URLS: Record<string, string> = {
  "win32-x64": "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe",
  "darwin-arm64": "https://desktop.docker.com/mac/main/arm64/Docker.dmg",
  "darwin-x64": "https://desktop.docker.com/mac/main/amd64/Docker.dmg",
};

const MAX_REDIRECTS = 5;

function download(url: string, destPath: string, redirectsLeft = MAX_REDIRECTS): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const req = https.get(url, (res) => {
      const { statusCode, headers } = res;
      if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location) {
        file.close();
        if (redirectsLeft <= 0) {
          reject(new Error("too many redirects"));
          return;
        }
        download(headers.location, destPath, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (statusCode !== 200) {
        file.close();
        reject(new Error(`download failed: HTTP ${statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    });
    req.on("error", reject);
  });
}

export async function downloadAndLaunchDockerInstaller(): Promise<InstallResult> {
  if (process.platform === "linux") {
    await shell.openExternal("https://docs.docker.com/desktop/install/linux-install/");
    return {
      ok: true,
      message:
        "Opened Docker's Linux install guide in your browser — pick your distro's package, install it, then come back and recheck.",
    };
  }

  const key = `${process.platform}-${process.arch}`;
  const url = INSTALLER_URLS[key];
  if (!url) {
    return {
      ok: false,
      message: `No known installer for ${key}. Install Docker Desktop manually from https://www.docker.com/products/docker-desktop.`,
    };
  }

  const filename = decodeURIComponent(url.split("/").pop()!);
  const destPath = path.join(app.getPath("temp"), filename);

  pushLog(`[docker-install] downloading ${url} -> ${destPath}`);
  try {
    await download(url, destPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushLog(`[docker-install] download failed: ${msg}`);
    return { ok: false, message: `Download failed: ${msg}` };
  }

  pushLog(`[docker-install] launching ${destPath}`);
  const openErr = await shell.openPath(destPath);
  if (openErr) {
    return {
      ok: false,
      message: `Downloaded but couldn't launch it automatically: ${openErr}. Open it from ${destPath}.`,
    };
  }

  return {
    ok: true,
    message:
      "Installer launched — follow the prompts (admin approval required). Docker Desktop may ask you to restart. Recheck once it's done.",
  };
}
