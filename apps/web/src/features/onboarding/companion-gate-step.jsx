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
 *
 * Mounted inside the onboarding page's own white card, which already
 * carries the "Step N of M" label + progress strip — this component is
 * just the step's content and its own action row.
 */

import { Button, Card } from "@/components/ui";
import { CompanionSetupGuide, useApiOrigin } from "@/features/companion";
import { cn } from "@/lib/cn";

export function CompanionGateStep({ submitting, onContinue, onBack }) {
  const { source, staleHostname, loading, refresh } = useApiOrigin();
  const live = source === "companion";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">
          Connect the companion
        </h2>
        <p className="mt-2 text-[14px] leading-[1.5] text-muted-fg">
          Your engagement routes API calls through your own laptop, so we
          need to confirm the companion app is installed, paired, and live
          before letting you in. This is a one-time check.
        </p>
      </div>

      <Card tone="sky" radius="lg" padding={14} className="flex items-center gap-2.5 text-[13px]">
        <span
          aria-hidden="true"
          className={cn("h-2 w-2 shrink-0 rounded-full", live ? "bg-mint-ink" : "bg-sky-ink")}
        />
        <span>
          {live
            ? "Companion connected."
            : staleHostname
              ? "The companion was seen before but has gone offline — reopen it to resume."
              : "Waiting for the companion to report a live connection…"}
        </span>
      </Card>

      <CompanionSetupGuide />

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={!live || submitting} onClick={onContinue}>
          {submitting ? "Entering…" : "Enter eSpace Hubs"}
        </Button>
        <Button variant="soft" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button variant="ghost" size="sm" onClick={() => refresh()} disabled={loading}>
          {loading ? "Checking…" : "Check now"}
        </Button>
      </div>
    </div>
  );
}
