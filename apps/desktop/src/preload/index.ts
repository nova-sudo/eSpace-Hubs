/**
 * Preload script — runs in the renderer's process but with Node
 * privileges available. Uses contextBridge to expose a TYPED, MINIMAL
 * API to the renderer's `window.companion`.
 *
 * Rule of thumb: this file is the public surface of the main process.
 * If a renderer needs something that isn't here, ADD A NEW BRIDGE
 * METHOD (and a matching ipcMain.handle in main/index.ts). Don't ever
 * grant the renderer raw `ipcRenderer` access — that's a security
 * footgun if the renderer ever loads remote content.
 */

import { contextBridge, ipcRenderer } from "electron";

const api = {
  backend: {
    start: () => ipcRenderer.invoke("backend:start"),
    stop: () => ipcRenderer.invoke("backend:stop"),
    status: () => ipcRenderer.invoke("backend:status"),
    logs: (lines?: number) => ipcRenderer.invoke("backend:logs", { lines }),
  },
  api: {
    ping: () => ipcRenderer.invoke("api:ping"),
  },
  vpn: {
    status: () => ipcRenderer.invoke("vpn:status"),
    connect: () => ipcRenderer.invoke("vpn:connect"),
    disconnect: () => ipcRenderer.invoke("vpn:disconnect"),
    discoverClient: () => ipcRenderer.invoke("vpn:discover-client"),
  },
  credentials: {
    // `has` returns { keychainAvailable, set } so the UI can show
    // "stored ✓" vs "not set" without ever receiving the plaintext.
    has: (key: string) => ipcRenderer.invoke("credentials:has", key),
    // `set` is fire-and-forget from the renderer's perspective — the
    // plaintext travels via IPC ONCE, is encrypted in the main
    // process, and never echoed back.
    set: (key: string, value: string) =>
      ipcRenderer.invoke("credentials:set", { key, value }),
    clear: (key: string) => ipcRenderer.invoke("credentials:clear", key),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke("settings:set", patch),
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke("shell:open-external", url),
  },
  // Phase 4 — onboarding wizard helpers.
  onboarding: {
    checkDocker: () =>
      ipcRenderer.invoke("docker:check") as Promise<{
        installed: boolean;
        version: string | null;
        message: string;
      }>,
    chooseDirectory: (title?: string) =>
      ipcRenderer.invoke("dialog:choose-directory", title) as Promise<{
        canceled: boolean;
        path: string | null;
      }>,
  },
  // Phase 3d — device-pairing + tunnel-registration. The token NEVER
  // crosses this bridge; `status` returns whether we hold one plus
  // its label, and `start` runs the full pairing handshake in main
  // and resolves with a success/failure summary.
  pair: {
    status: () => ipcRenderer.invoke("companion:status"),
    start: () => ipcRenderer.invoke("companion:pair"),
    cancel: () => ipcRenderer.invoke("companion:pair-cancel"),
    forget: () => ipcRenderer.invoke("companion:unpair"),
  },
  tunnel: {
    register: () => ipcRenderer.invoke("tunnel:register"),
    clear: () => ipcRenderer.invoke("tunnel:clear"),
  },
} as const;

contextBridge.exposeInMainWorld("companion", api);

// Re-export the type so the renderer's tsconfig can pick it up via
// `import type { CompanionApi } from "..."` without depending on
// the actual preload runtime.
export type CompanionApi = typeof api;
