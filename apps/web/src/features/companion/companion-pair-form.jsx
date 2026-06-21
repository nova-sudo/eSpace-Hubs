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
    return <Panel title="Loading…" body="One moment." />;
  }

  if (!user) {
    // AuthGuard should never let an unauthenticated user reach here,
    // but if it does for some reason, give the user a clear next step.
    return (
      <Panel
        title="Sign in to approve."
        body="You need to be signed in to your eSpace Dev Hub account before you can approve a companion device."
      />
    );
  }

  if (phase === "error" && error?.code === "missing_code") {
    return (
      <Panel
        title="Missing pairing code."
        body="Your companion app should have opened this page with a code in the URL. Open the companion and click ‘Pair this device’ again."
      />
    );
  }

  if (phase === "approved") {
    return (
      <Panel
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
    <div className="mx-auto flex max-w-md flex-col gap-5 py-12">
      <div>
        <h1
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            letterSpacing: "-0.7px",
          }}
        >
          Approve companion device
        </h1>
        <p
          className="mt-1 text-muted-fg"
          style={{ fontSize: 13.5, lineHeight: 1.5 }}
        >
          Approve this only if you started the pairing from your own
          companion app a moment ago. If you didn't, click Cancel and
          tell whoever did to stop.
        </p>
      </div>

      <DetailGrid
        rows={[
          { label: "Pairing code", value: code },
          { label: "Your account", value: user.email },
        ]}
      />

      {error ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--bad)",
            lineHeight: 1.5,
          }}
        >
          {humanise(error)}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleApprove}
          disabled={phase === "submitting" || !code}
          style={primaryBtn(phase === "submitting" || !code)}
        >
          {phase === "submitting" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          disabled={phase === "submitting"}
          style={secondaryBtn(phase === "submitting")}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DetailGrid({ rows }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-sub, 3px)",
        background: "var(--card)",
        padding: 16,
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        rowGap: 8,
        columnGap: 16,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
    >
      {rows.map((r) => (
        <RowEntry key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  );
}

function RowEntry({ label, value }) {
  return (
    <>
      <span
        style={{
          color: "var(--muted-fg)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          fontSize: 10,
          alignSelf: "center",
        }}
      >
        {label}
      </span>
      <span style={{ color: "var(--fg)", overflowWrap: "anywhere" }}>
        {value}
      </span>
    </>
  );
}

function Panel({ title, body }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 py-12">
      <h1
        className="font-semibold"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          letterSpacing: "-0.6px",
        }}
      >
        {title}
      </h1>
      <p
        className="text-muted-fg"
        style={{ fontSize: 13.5, lineHeight: 1.5 }}
      >
        {body}
      </p>
    </div>
  );
}

function primaryBtn(disabled) {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    background: "var(--accent)",
    color: "var(--accent-on, #fff)",
    border: 0,
    borderRadius: "var(--radius-sub, 3px)",
    padding: "12px 16px",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function secondaryBtn(disabled) {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    background: "transparent",
    color: "var(--fg)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sub, 3px)",
    padding: "12px 16px",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
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
