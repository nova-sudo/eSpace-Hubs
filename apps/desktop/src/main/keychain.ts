/**
 * OS-keychain-backed credential storage.
 *
 * Wraps electron's `safeStorage` API: encryption keys live in the OS
 * keychain (Windows DPAPI / macOS Keychain / Linux libsecret) so the
 * encrypted blobs we persist to JSON are useless to anyone who copies
 * the config file off the machine — they'd need login access to the
 * same OS user account to decrypt.
 *
 * Why this exists separately from settings.ts
 * ───────────────────────────────────────────
 * settings.ts is a generic typed JSON store; its values pass through
 * to disk as-is. Credentials (VPN password, etc.) deserve the extra
 * decrypt step. By keeping the two layers distinct:
 *
 *   1. Renderer code can never accidentally request a credential —
 *      the IPC handler `credentials:has` returns a boolean, never the
 *      plaintext. Renderer asks "is the VPN password set?", main
 *      answers yes/no.
 *   2. Persistence on disk separates: settings.json holds non-secret
 *      config; the encrypted credential blobs live in their own
 *      object so a backup tool can include settings without picking
 *      up the credentials by accident.
 *
 * Encryption availability
 * ───────────────────────
 * `safeStorage.isEncryptionAvailable()` is FALSE on:
 *   - Linux with no libsecret-1 / gnome-keyring installed
 *   - Locked / unconfigured keychain access
 *
 * When unavailable, we refuse to set credentials and surface the
 * reason to the UI so the user can fix it. We never silently fall
 * back to plaintext storage — that would be worse than the user
 * thinks.
 */

import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

const FILE_NAME = "credentials.json";

type Schema = Record<string, string>; // key → base64(encrypted blob)

function filePath(): string {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function read(): Schema {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Schema;
    }
    return {};
  } catch {
    return {};
  }
}

function write(data: Schema): void {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 0o600 (owner read/write only) on the file; default JSON store
  // perms vary by platform.
  fs.writeFileSync(p, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function isAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function has(key: string): boolean {
  return typeof read()[key] === "string" && read()[key]!.length > 0;
}

export function set(key: string, plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS keychain unavailable on this machine. On Linux you may need libsecret-1-dev or gnome-keyring installed; on Windows/macOS this should always work.",
    );
  }
  const encrypted = safeStorage.encryptString(plaintext);
  const data = read();
  data[key] = encrypted.toString("base64");
  write(data);
}

export function get(key: string): string | null {
  const stored = read()[key];
  if (!stored) return null;
  try {
    const buf = Buffer.from(stored, "base64");
    return safeStorage.decryptString(buf);
  } catch {
    // Decryption failure usually means the keychain entry was wiped
    // or the user logged in as a different OS user since the value
    // was stored. Treat as "not set" so the UI prompts to re-enter.
    return null;
  }
}

export function clear(key: string): void {
  const data = read();
  if (key in data) {
    delete data[key];
    write(data);
  }
}
