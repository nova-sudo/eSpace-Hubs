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
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke("settings:set", patch),
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke("shell:open-external", url),
  },
} as const;

contextBridge.exposeInMainWorld("companion", api);

// Re-export the type so the renderer's tsconfig can pick it up via
// `import type { CompanionApi } from "..."` without depending on
// the actual preload runtime.
export type CompanionApi = typeof api;
