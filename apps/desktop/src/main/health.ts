/**
 * API healthcheck — single-shot ping to the local Express server.
 *
 * The IPC handler calls this on demand from the renderer; the
 * renderer polls it on a short interval (e.g. every 3s) to show a
 * green/red indicator next to "Backend status."
 */

const HEALTH_URL = "http://localhost:4000/healthz";
const TIMEOUT_MS = 1500;

export async function pingApi(): Promise<{
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(HEALTH_URL, {
      method: "GET",
      signal: controller.signal,
      // Don't follow redirects — /healthz should be a flat 200. A
      // 3xx response means we hit the wrong server; surface that
      // instead of chasing it.
      redirect: "manual",
    });
    clearTimeout(timer);
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: null,
      latencyMs: null,
      // Common reasons:
      //   ECONNREFUSED   - container is down OR stopped
      //   ETIMEDOUT      - container is starting but not listening yet
      //   AbortError     - our own timeout fired
      // Surface the raw message so the UI can show something useful.
      error: message,
    };
  }
}
