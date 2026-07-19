/**
 * "Clone repo" onboarding action — git clone + npm install in one click,
 * so a first-time user doesn't need to already have a checkout (or know
 * npm/git) before they can point the companion at a repo folder.
 *
 * Runs as fire-and-forget from the IPC handler; progress is exposed via
 * `getCloneState()` polling (same shape as tunnel-spawn.ts's
 * subscribe/getState — this repo's existing convention for long-running
 * subprocess state instead of pushing events over IPC).
 *
 * Progress signal
 * ────────────────
 * git's `--progress` flag prints real "Receiving objects: NN%" lines we
 * parse for a genuine percentage during the clone. `npm install` has no
 * comparable signal across npm versions, so its share of the bar is
 * cosmetic — the renderer creeps it forward while phase is "installing"
 * and snaps to 100 on completion. See Onboarding.tsx.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { settings } from "./settings.js";
import { pushLog } from "./docker.js";

export const DEFAULT_REPO_URL = "https://github.com/nova-sudo/eSpace-Hubs.git";

// The clone gets 0-60% of the overall bar (real signal); install gets
// 60-100% (cosmetic creep, driven client-side).
const CLONE_PCT_WEIGHT = 60;

export interface CloneState {
  phase: "idle" | "cloning" | "installing" | "done" | "error";
  pct: number;
  message: string;
  repoPath: string | null;
}

let state: CloneState = { phase: "idle", pct: 0, message: "", repoPath: null };

function setState(patch: Partial<CloneState>): void {
  state = { ...state, ...patch };
}

export function getCloneState(): CloneState {
  return { ...state };
}

export function resetCloneState(): void {
  state = { phase: "idle", pct: 0, message: "", repoPath: null };
}

const RECEIVING_OBJECTS_RE = /Receiving objects:\s+(\d+)%/;

// Keep the wizard's error paragraph readable — git/npm can dump
// anywhere from one line to a full usage/help page on failure. Head
// (not tail) is kept: git's own errors put the actual problem first
// ("fatal: …", "usage: git clone …") and pile exhaustive flag
// reference after it. Full output always still goes to pushLog/the
// Logs panel.
const MESSAGE_MAX = 400;
function truncateMessage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MESSAGE_MAX) return trimmed;
  return `${trimmed.slice(0, MESSAGE_MAX)}… (see Logs for the full output)`;
}

function runGitClone(url: string, dest: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    pushLog(`[repo-clone] git clone ${url} -> ${dest}`);
    // NOT shell:true here, unlike npm below — git ships as a real
    // git.exe on Windows (resolves fine via plain CreateProcess), while
    // npm is a .cmd shim that needs a shell to resolve. Routing this
    // through cmd.exe anyway (as an earlier version did) re-quotes the
    // command line and can corrupt git's argument parsing — the
    // symptom is git bailing out and dumping its full `usage: git
    // clone …` help text instead of actually cloning.
    const child = spawn("git", ["clone", "--progress", url, dest], {
      shell: false,
      windowsHide: true,
    });
    let tail = "";
    // git writes --progress output to stderr, clone banner included.
    // Accumulate (not overwrite) — a real error can span more than one
    // `data` event, and we'd otherwise keep only the last fragment.
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      tail += text;
      pushLog(`[repo-clone/git] ${text.trim()}`);
      const m = RECEIVING_OBJECTS_RE.exec(text);
      if (m) {
        const gitPct = Number(m[1]);
        setState({
          pct: Math.round((gitPct / 100) * CLONE_PCT_WEIGHT),
          message: `Cloning… ${gitPct}%`,
        });
      }
    });
    child.on("error", (err) => {
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      resolve({
        ok: false,
        message: isMissing
          ? "git not found on PATH. Install Git, then retry."
          : err.message,
      });
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, message: "Cloned." });
      else
        resolve({
          ok: false,
          message: tail.trim() ? truncateMessage(tail) : `git clone exited with code ${code}.`,
        });
    });
  });
}

function runNpmInstall(cwd: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    pushLog(`[repo-clone] npm install (cwd=${cwd})`);
    const child = spawn("npm", ["install"], {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let tail = "";
    child.stdout?.on("data", (d) => {
      const text = d.toString();
      tail += text;
      pushLog(`[repo-clone/npm] ${text.trim()}`);
    });
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      tail += text;
      pushLog(`[repo-clone/npm/err] ${text.trim()}`);
    });
    child.on("error", (err) => {
      const isMissing = (err as NodeJS.ErrnoException).code === "ENOENT";
      resolve({
        ok: false,
        message: isMissing
          ? "npm not found on PATH. Install Node.js, then retry."
          : err.message,
      });
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, message: "Dependencies installed." });
      else
        resolve({
          ok: false,
          message: tail.trim() ? truncateMessage(tail) : `npm install exited with code ${code}.`,
        });
    });
  });
}

/**
 * Clone `repoUrl` (default: this repo) into a new folder under
 * `parentDir`, then run `npm install` at its root. Updates `state` as
 * it goes; callers poll `getCloneState()` rather than awaiting this
 * directly (the IPC handler fires this and returns immediately).
 */
export async function cloneAndInstall(parentDir: string, repoUrl?: string): Promise<void> {
  const url = (repoUrl && repoUrl.trim()) || DEFAULT_REPO_URL;
  const folderName = url.split("/").pop()!.replace(/\.git$/, "");
  const dest = path.join(parentDir, folderName);

  if (fs.existsSync(dest)) {
    setState({
      phase: "error",
      pct: 0,
      message: `${dest} already exists — pick an empty parent folder, or remove it first.`,
      repoPath: null,
    });
    return;
  }

  setState({ phase: "cloning", pct: 0, message: "Cloning…", repoPath: null });
  const cloneResult = await runGitClone(url, dest);
  if (!cloneResult.ok) {
    setState({ phase: "error", message: cloneResult.message, repoPath: null });
    return;
  }

  setState({
    phase: "installing",
    pct: CLONE_PCT_WEIGHT,
    message: "Installing dependencies… (this can take a minute)",
  });
  const installResult = await runNpmInstall(dest);
  if (!installResult.ok) {
    // The clone itself succeeded — record repoPath anyway so the user
    // isn't forced to re-clone just because npm install hiccuped; they
    // can retry the install manually or via "Recheck".
    setState({ phase: "error", message: installResult.message, repoPath: dest });
    return;
  }

  setState({ phase: "done", pct: 100, message: "Ready.", repoPath: dest });
  settings.set("repoPath", dest);
}
