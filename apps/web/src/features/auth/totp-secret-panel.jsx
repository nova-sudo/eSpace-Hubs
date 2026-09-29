"use client";

/**
 * QR + manual-entry secret for adding eSpace Hubs to an authenticator
 * app. Shared by first-time enrolment (TotpSetupForm) and "Move to a
 * new phone" (MoveTwoFactorDialog).
 *
 * The QR is rendered client-side with the `qrcode` package. The
 * otpauth URL carries the user's email + raw secret, so it must never
 * be sent to a third-party QR service — encoding stays in the browser.
 */

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Label } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Render an otpauth:// URL to a PNG data URL.
 * Returns `{ status: "pending" | "ready" | "failed", dataUrl }` — "pending"
 * until the async render for THIS url settles, so the panel can show a
 * placeholder instead of a false "QR rendering failed" on every first paint.
 */
export function useTotpQrDataUrl(otpauthUrl) {
  // The result is tagged with the url it was rendered from; a result for
  // another url (or none yet) reads as pending.
  const [result, setResult] = useState({ url: null, dataUrl: "", failed: false });
  useEffect(() => {
    if (!otpauthUrl) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // No explicit `color` override — the library's default pure
        // black/white gives the best scan contrast, and a QR code's
        // pixels aren't a themed UI surface anyway.
        const dataUrl = await QRCode.toDataURL(otpauthUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
        });
        if (!cancelled) setResult({ url: otpauthUrl, dataUrl, failed: false });
      } catch {
        // Non-fatal — the manual-entry secret still lets the user finish.
        if (!cancelled) setResult({ url: otpauthUrl, dataUrl: "", failed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);
  if (!otpauthUrl) return { status: "failed", dataUrl: "" };
  if (result.url !== otpauthUrl) return { status: "pending", dataUrl: "" };
  return result.failed ? { status: "failed", dataUrl: "" } : { status: "ready", dataUrl: result.dataUrl };
}

export function TotpSecretPanel({ otpauthUrl, secret, className = "mb-5" }) {
  const qr = useTotpQrDataUrl(otpauthUrl);
  const formatted = useMemo(() => formatTotpSecret(secret), [secret]);

  return (
    <div className={cn("flex items-center gap-4 rounded-[var(--radius-lg)] bg-card-alt p-4", className)}>
      {qr.status === "ready" ? (
        <img
          src={qr.dataUrl}
          alt="TOTP QR code"
          width={96}
          height={96}
          className="block shrink-0 rounded-[var(--radius-md)] bg-white p-2"
        />
      ) : qr.status === "pending" ? (
        <div
          role="status"
          aria-label="Generating QR code"
          className="h-24 w-24 shrink-0 animate-pulse rounded-[var(--radius-md)] bg-card"
        />
      ) : (
        <div className="flex h-24 w-24 shrink-0 items-center text-center text-[11px] text-muted-fg">
          QR rendering failed — use manual entry.
        </div>
      )}

      <div className="min-w-0">
        <Label>Can&apos;t scan? Type this secret instead</Label>
        <code className="mt-1 block break-all font-mono text-[12px] leading-[1.5] text-fg">
          {formatted}
        </code>
        <div className="mt-2 text-[11.5px] text-muted-fg">
          Manual entry details: time-based · SHA-1 · 6 digits · 30s period
        </div>
      </div>
    </div>
  );
}

/**
 * Pretty-print the base32 secret in groups of four for manual entry.
 * Authenticator apps strip whitespace; humans typing 32 chars benefit
 * from chunking.
 */
export function formatTotpSecret(s) {
  if (!s) return "";
  return s.replace(/(.{4})/g, "$1 ").trim();
}
