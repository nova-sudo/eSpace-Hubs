/**
 * Shared in-memory log tail — every companion-managed subprocess
 * (the backend, cloudflared, git/npm during clone) pushes its output
 * here so the renderer's Logs panel shows one merged timeline via a
 * single `backend:logs` IPC call, instead of one channel per
 * subprocess.
 *
 * Split out of what used to be docker.ts once that module stopped
 * being about Docker at all (see backend-process.ts) — every other
 * subprocess module already imported pushLog from it, so it needed a
 * home that isn't named after the one thing it no longer does.
 */

const LOG_TAIL_MAX = 500;

let logTail: string[] = [];

export function pushLog(line: string): void {
  const split = line.split(/\r?\n/).filter(Boolean);
  for (const s of split) {
    logTail.push(s);
    if (logTail.length > LOG_TAIL_MAX) logTail.shift();
  }
}

export function tailLogs(lines: number = 100): string[] {
  return logTail.slice(-Math.max(1, Math.min(lines, LOG_TAIL_MAX)));
}
