"use client";

/**
 * CompanionPairForm — approval UI for an in-flight device pairing.
 *
 * Flow:
 *   1. The companion app generated a pairing code via
 *      POST /api/v1/companion/pair/start, surfaced it to the user as
 *      a URL like https://app.example.com/companion/pair?code=ABCD-1234,
 *      and is now polling /pair/poll for the approval.
 *   2. The user opens that URL in their logged-in browser. This form
 *      reads `?code=...`, calls POST /api/v1/companion/pair/approve.
 *   3. The server mints a bearer token, stashes it server-side, and
 *      returns it to the companion on its NEXT poll.
 *
 * Failure modes surfaced:
 *   pairing_not_found      → code doesn't exist or already cleaned up
 *   pairing_expired        → past the 5-min TTL — user has to restart
 *   pairing_already_approved → another tab beat them to it
 *   unauthenticated        → AuthGuard catches first; defensive
 *
 * After approve we DON'T navigate anywhere — the success state shows a
 * "you can close this tab" panel because the desktop app is where the
 * action happens next. Adding a deeper-link to "Open companion" would
 * need a custom URL scheme the companion registers; deferred.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import { refreshApiOrigin } from "./use-api-origin.js";

export function CompanionPairForm() {
  const params = useSearchParams();
  const { user, loading } = useSession();
  const code = params.get("code") || "";

  const [phase, setPhase] = useState("idle"); // idle | submitting | approved | error
  const [error, setError] = useState(null);
  const [device, setDevice] = useState(null);

  // Guard against typos / malformed links.
  useEffect(() => {
    if (!code) {
      setPhase("error");
      setError({ code: "missing_code" });
    }
  }, [code]);

  if (loading) {
    return <PanelCard title="Loading…" body="One moment." />;
  }

  if (!user) {
    // AuthGuard should never let an unauthenticated user reach here,
    // but if it does for some reason, give the user a clear next step.
    return (
      <PanelCard
        title="Sign in to approve."
        body="You need to be signed in to your eSpace Dev Hub account before you can approve a companion device."
      />
    );
  }

  if (phase === "error" && error?.code === "missing_code") {
    return (
      <PanelCard
        title="Missing pairing code."
        body="Your companion app should have opened this page with a code in the URL. Open the companion and click ‘Pair this device’ again."
      />
    );
  }

  if (phase === "approved") {
    return (
      <PanelCard
        title="Companion paired."
        body={
          <>
            We've connected{" "}
            <strong>{device?.name || "your companion"}</strong> to your
            account. You can close this tab — the companion app should
            move out of the “waiting for approval” state in a few seconds.
          </>
        }
      />
    );
  }

  async function handleApprove() {
    setPhase("submitting");
    setError(null);
    const r = await apiPost("/companion/pair/approve", { code });
    if (!r.ok) {
      setPhase("error");
      setError(r.error);
      return;
    }
    setDevice(r.data?.device || null);
    setPhase("approved");
    // The companion will heartbeat the tunnel within seconds; pre-empt
    // the next 60s store refresh so the header chip / setup guide
    // update immediately when the user navigates back to the app.
    void refreshApiOrigin();
  }

  return (
    <div className="mx-auto flex max-w-[440px] flex-col py-12">
      <div
        className="rounded-[var(--radius-xl)] bg-card p-7"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">
          Approve companion device
        </h1>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-muted-fg">
          Approve this only if you started the pairing from your own
          companion app a moment ago. If you didn't, click Cancel and
          tell whoever did to stop.
        </p>

        <div className="mt-5">
          <DetailRow label="Pairing code" value={code} />
          <DetailRow label="Your account" value={user.email} />
        </div>

        {error ? (
          <p className="mt-4 text-[12.5px] leading-[1.5] text-peach-ink">
            {humanise(error)}
          </p>
        ) : null}

        <div className="mt-6 flex gap-2">
          <Button
            type="button"
            onClick={handleApprove}
            disabled={phase === "submitting" || !code}
          >
            {phase === "submitting" ? "Approving…" : "Approve"}
          </Button>
          <Button
            type="button"
            variant="soft"
            onClick={() => window.close()}
            disabled={phase === "submitting"}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line py-2.5 first:border-t-0 first:pt-0">
      <span className="text-[12px] font-semibold text-muted-fg">{label}</span>
      <span className="text-[13px] text-fg" style={{ overflowWrap: "anywhere" }}>
        {value}
      </span>
    </div>
  );
}

function PanelCard({ title, body }) {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col py-12">
      <div
        className="rounded-[var(--radius-xl)] bg-card p-7"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">{title}</h1>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-muted-fg">{body}</p>
      </div>
    </div>
  );
}

function humanise(err) {
  if (!err) return "Something went wrong. Try again.";
  if (err.code === "pairing_not_found")
    return "Pairing code not found. Restart the pairing from the companion app and click the new link.";
  if (err.code === "pairing_expired")
    return "Pairing code expired (codes are valid for 5 minutes). Restart the pairing from the companion app.";
  if (err.code === "pairing_already_approved")
    return "This pairing was already approved. The companion should be connected — check the companion app.";
  if (err.code === "unauthenticated")
    return "Your session expired. Sign in and reopen the pairing link.";
  return err.message || "Something went wrong. Try again.";
}
