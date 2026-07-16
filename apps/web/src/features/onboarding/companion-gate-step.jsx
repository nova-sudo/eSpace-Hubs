"use client";

/**
 * Step 2 of onboarding for crealogix-engagement users only.
 *
 * Crealogix's private infra (git.bcn.crealogix.net) isn't reachable from
 * Vercel, so these users must pair the desktop companion app before their
 * account is usable — every /api/v1/* call for them routes through it.
 * Rather than invent a new "verified" flag on the server, we simply defer
 * the profile POST (which is what actually flips onboardingCompletedAt)
 * until useApiOrigin() reports a live companion connection. If the user
 * reloads or navigates away mid-step, AuthGuard still bounces them back
 * here — the gate is enforced by the same mechanism that already exists.
 */

import { CompanionSetupGuide, useApiOrigin } from "@/features/companion";

export function CompanionGateStep({ submitting, onContinue, onBack }) {
  const { source, staleHostname, loading, refresh } = useApiOrigin();
  const live = source === "companion";

  return (
    <div className="flex flex-col justify-center">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex w-fit items-center gap-1.5 text-[11px] uppercase tracking-[1px] text-muted-fg transition-colors hover:text-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        ← Back
      </button>

      <div
        className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-border-strong px-3 py-1.5"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        <span
          className="block h-1.5 w-1.5 rounded-full"
          style={{ background: live ? "var(--good)" : "var(--accent)" }}
        />
        <span className="uppercase tracking-[1.5px] text-muted-fg">
          Step 2 of 2 · Companion required
        </span>
      </div>

      <h1
        className="m-0"
        style={{
          fontFamily: "var(--font-dot)",
          fontWeight: 900,
          fontSize: 42,
          lineHeight: 0.98,
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        Connect the <em className="accent">companion</em>.
      </h1>

      <p
        className="mb-8 mt-[18px] max-w-xl text-[15px] leading-[1.55]"
        style={{ color: "var(--muted-fg)" }}
      >
        Your engagement routes API calls through your own laptop, so we need
        to confirm the companion app is installed, paired, and live before
        letting you into the Dev Hub. This is a one-time check.
      </p>

      <div className="max-w-xl">
        <CompanionSetupGuide />
      </div>

      <div className="mt-6 flex max-w-xl items-center gap-3.5">
        <button
          type="button"
          disabled={!live || submitting}
          onClick={onContinue}
          className="rounded-[var(--radius-sub)] px-[22px] py-3 text-[11px] font-bold uppercase tracking-[1px] transition-opacity disabled:opacity-40"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--accent)",
            color: "var(--accent-on)",
          }}
        >
          {submitting ? "Entering…" : "Enter eSpace Dev Hub →"}
        </button>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="rounded-[var(--radius-sub)] border border-border-strong px-[18px] py-3 text-[11px] font-bold uppercase tracking-[1px] text-fg transition-opacity disabled:opacity-60"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {loading ? "Checking…" : "Check now"}
        </button>
      </div>
      {!live ? (
        <span
          className="mt-3 block text-[12px]"
          style={{ fontFamily: "var(--font-mono)", color: "var(--muted-fg)" }}
        >
          {staleHostname
            ? "The companion was seen before but has gone offline — reopen it to resume."
            : "Waiting for the companion to report a live connection…"}
        </span>
      ) : null}
    </div>
  );
}
