"use client";

/**
 * Mirror-mode sync for the integrations store.
 *
 * Different model from the other six stores: this one is PUSH-ONLY.
 * No pull on session establishment because the server's source of
 * truth is encrypted-at-rest tokens — the public list endpoint
 * deliberately returns booleans (hasAccessToken / hasApiToken /
 * connected) instead of plaintext, so pulling would tell us the
 * user is connected but give us no usable tokens.
 *
 * The one-shot localStorage → API upload is handled by
 * /api/v1/migrate/import (M6.2), invoked when the user signs in for
 * the first time on a device with existing localStorage data.
 *
 * From there on:
 *   - Local saves mirror to POST /integrations (server encrypts)
 *   - Local disconnects mirror to DELETE /integrations/:providerId
 *   - Local disconnectAll lists + deletes each
 *
 * Net result: the server's encrypted-at-rest copy stays in sync with
 * the local plaintext copy. Server-side proxy (M6.3) can use the
 * encrypted tokens directly; localStorage stays the source of truth
 * for the existing Next.js proxy routes until those migrate over.
 */

import { apiDelete, apiGet, apiPost } from "@/lib/api-client";

const FAIL_LOG_PREFIX = "[integrations-sync]";

function isAuthError(err) {
  return err?.code === "unauthenticated" || err?.code === "totp_required";
}

/**
 * Mirror a saveConnection write. The payload format from the local
 * store is provider-specific (GitHub OAuth: {accessToken, email};
 * GitLab/Jira PAT: {accessToken|apiToken, email, endpointUrl}). We
 * forward what's relevant; the server's Zod schema rejects extras.
 *
 * Server validates that at least one of {accessToken, apiToken} is
 * present. Local payloads always carry one (the store guards via
 * isConnected); a payload that wouldn't trigger isConnected wouldn't
 * call saveConnection in the first place.
 */
export async function mirrorSaveConnection(providerId, payload) {
  if (!providerId || !payload || typeof payload !== "object") return;
  const body = {
    providerId,
    label: typeof payload.label === "string" ? payload.label : providerId,
  };
  // Forward only the fields the API accepts. Anything else stays
  // local-only (e.g. local-only debug flags).
  if (payload.accessToken) body.accessToken = payload.accessToken;
  if (payload.apiToken) body.apiToken = payload.apiToken;
  if (payload.refreshToken) body.refreshToken = payload.refreshToken;
  if (payload.email) body.email = payload.email;
  if (payload.endpointUrl) body.endpointUrl = payload.endpointUrl;
  if (Array.isArray(payload.scopes)) body.scopes = payload.scopes;
  if (typeof payload.expiresAt === "string") body.expiresAt = payload.expiresAt;

  if (!body.accessToken && !body.apiToken) {
    // The local store can carry metadata-only entries during the
    // OAuth dance. Don't mirror those; the followup save with the
    // real token is what we want on the server.
    return;
  }

  const r = await apiPost("/integrations", body);
  if (r.ok) return;
  if (isAuthError(r.error)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} save failed:`,
    r.error?.code,
    r.error?.message,
  );
}

export async function mirrorDisconnectProvider(providerId) {
  if (!providerId) return;
  const r = await apiDelete(`/integrations/${encodeURIComponent(providerId)}`);
  if (r.ok) return;
  if (isAuthError(r.error)) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${FAIL_LOG_PREFIX} disconnect failed:`,
    r.error?.code,
    r.error?.message,
  );
}

/**
 * disconnectAll on the local store wipes the entire integrations map.
 * No bulk endpoint server-side; we list and delete each.
 */
export async function mirrorDisconnectAll() {
  const list = await apiGet("/integrations");
  if (!list.ok) {
    if (isAuthError(list.error)) return;
    return;
  }
  const items = Array.isArray(list.data?.integrations)
    ? list.data.integrations
    : [];
  await Promise.all(
    items.map((i) =>
      apiDelete(`/integrations/${encodeURIComponent(i.providerId)}`).catch(
        () => null,
      ),
    ),
  );
}
