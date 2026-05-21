/**
 * Vite config for the renderer (Electron's BrowserWindow).
 *
 * Build output lands in `dist/renderer/`. The main process loads
 * `dist/renderer/index.html` in production. In dev, vite serves on
 * :5173 and main loads the URL directly.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // Root is the renderer source folder so `index.html`'s `<script>`
  // refs resolve relatively without prefixes.
  root: path.resolve(__dirname, "src/renderer"),
  plugins: [react()],
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome120",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
