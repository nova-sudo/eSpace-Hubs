/**
 * Browser → API service proxy fetcher.
 *
 * Post-M7.9c: hits the API service's encrypted-at-rest proxy
 *   GET /api/v1/integrations/proxy/<providerId>/<rest of path>
 * The API decrypts the user's token in-process (it never touches the
 * browser), forwards to the upstream provider, and streams the
 * response back through an allowlist of safe headers.
 *
 * Auth: the session cookie is sent via `credentials: "include"` (the
 * Next.js rewrite proxies /api/v1/* to localhost:4000 same-origin in
 * dev). The API rejects with 401 unauthenticated/totp_required if
 * the session is missing — those errors bubble up to the caller as
 * thrown Errors, matching the pre-M7.9c contract.
 *
 * Pre-M7.9c shape (deleted): we used to read the plaintext token
 * from localStorage and ship it as `x-devhub-token` to a Next.js
 * proxy route. That pattern defeated the M6 encryption-at-rest
 * design and is now retired.
 */
export async function proxyFetch(providerId, path, init = {}) {
  if (!providerId) throw new Error("proxyFetch: providerId is required");
  const cleanPath = String(path || "").replace(/^\//, "");
  const url = `/api/v1/integrations/proxy/${providerId}/${cleanPath}`;

  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  // POST bodies stay JSON-shaped — keep callers' existing convention.
  if (method !== "GET" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const res = await fetch(url, {
    method,
    credentials: "include",
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const text = await res.text();
      // Surface the API's structured error message when present.
      const parsed = text ? JSON.parse(text) : null;
      detail = parsed?.error?.message || parsed?.message || text.slice(0, 200);
    } catch {
      /* ignore parse errors — empty detail is fine */
    }
    throw new Error(
      `${providerId} ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return res.json();
}
