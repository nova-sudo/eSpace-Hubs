"use client";

/**
 * M-OB — the post-login, pre-hub onboarding form.
 *
 * Captures three fields once after first login:
 *   - displayName  (pre-filled from invite)
 *   - employeeId   (free text; informal, until Zoho lands)
 *   - department   (free text; resolved to a hub via the shared
 *                    registry's `departments` map at submit time)
 *
 * On submit the API:
 *   1. Persists the three fields on `users`.
 *   2. Resolves `department` → hubId via getHubIdForDepartment.
 *   3. Sets allowedHubs / primaryHub / onboardingCompletedAt.
 *   4. Returns the new PublicUser + a `redirectTo` path.
 *
 * The frontend then refreshes the session (so the AuthGuard sees the
 * new onboardingCompletedAt and stops redirecting here), and pushes
 * to `redirectTo`.
 *
 * Design intent — this page is its OWN visual world, not a hub:
 *   - Full-bleed neutral background (no hub theme) with the Nothing UI
 *     halftone dot-grid texture.
 *   - Large dot-matrix (Doto) display type for the headline.
 *   - The single cobalt accent + light/dark tokens, so it honours the
 *     user's theme like every other surface.
 *   - Minimal chrome: no header, no nav, no footer. The user is
 *     here to complete one task.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { useSession } from "@/features/auth";
import { resetHubsStore } from "@/features/hubs";
import { HUBS } from "@espace-devhub/shared/hubs";

// Common departments rendered as quick-pick chips above the free-text
// input. The registry knows about more (engineering/platform/backend/
// frontend/mobile/devops/sre for Dev; qa/quality-assurance/testing/
// quality for QA) but a short list keeps the picker calm. Free-text
// covers the rest.
const QUICK_PICKS = ["Engineering", "QA", "Platform", "DevOps", "Frontend"];

// No theme override — onboarding inherits the Nothing UI tokens (cobalt accent,
// light/dark) so it honours the user's theme like every other surface.
const ONBOARDING_THEME = {};

export function OnboardingPage() {
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill displayName from the existing session user once it
  // resolves. Setting state inside an effect (not directly in the
  // render) keeps the input controlled and editable.
  useEffect(() => {
    if (user?.displayName && !displayName) {
      setDisplayName(user.displayName);
    }
  }, [user, displayName]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!displayName.trim() || !employeeId.trim() || !department.trim()) {
      toast.error("All three fields are required.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiPost("/onboarding", {
        displayName: displayName.trim(),
        employeeId: employeeId.trim(),
        department: department.trim(),
      });
      if (!r.ok) {
        toast.error(r.error?.message || "Couldn't save onboarding.");
        return;
      }
      // Refresh the session so the new onboardingCompletedAt lands
      // in useSession() — otherwise the AuthGuard would still see
      // the stale "incomplete" state and bounce us back here.
      await refresh();
      // Wipe the hubs cache so the next /hubs/me fetch picks up the
      // new allowedHubs + primaryHub.
      resetHubsStore();
      const target = r.data?.redirectTo || "/";
      router.replace(target);
    } catch (err) {
      toast.error(err?.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Compute a preview of which hub the department maps to. Shown
  // inline as feedback before submit. Uses the same registry as the
  // server so the preview is bit-exact with what the API will do.
  const previewHub = previewHubForDepartment(department);

  if (loading || !user) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--muted-fg)",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
        aria-busy="true"
      >
        Loading…
      </main>
    );
  }

  return (
    <main
      className="relative overflow-hidden"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--fg)",
        ...ONBOARDING_THEME,
      }}
    >
      {/* Nothing UI signature: faint halftone dot-grid behind everything. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(var(--dot-dim) 1px, transparent 1px)",
          backgroundSize: "13px 13px",
        }}
      />

      <div className="relative mx-auto grid min-h-screen max-w-3xl grid-rows-[1fr_auto] px-6 py-16">
        <div className="flex flex-col justify-center">
          <div
            className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-border-strong px-3 py-1.5"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
          >
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            <span className="uppercase tracking-[1.5px] text-muted-fg">
              Step 1 of 1 · One-time setup
            </span>
          </div>

          <h1
            className="m-0"
            style={{
              fontFamily: "var(--font-dot)",
              fontWeight: 900,
              fontSize: 50,
              lineHeight: 0.95,
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            Welcome to <em className="accent">eSpace</em> Dev Hub.
          </h1>

          <p
            className="mb-9 mt-[18px] max-w-xl text-[15px] leading-[1.55]"
            style={{ color: "var(--muted-fg)" }}
          >
            Three quick fields so we know how to route you. You can change
            them later from your profile — there's no wrong answer here.
          </p>

          <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-6">
            <OnboardingField
              label="Display name"
              hint="What we'll call you in the chrome."
            >
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="w-full rounded-[var(--radius-sub)] border border-border-strong bg-card px-3.5 py-3 text-[14.5px] text-fg outline-none transition-colors placeholder:text-dim-fg focus:border-accent"
              />
            </OnboardingField>

            <OnboardingField
              label="Employee ID"
              hint="Whatever your HR system calls it. Zoho will overwrite this later if it differs."
            >
              <input
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="e.g. EMP-1042"
                className="w-full rounded-[var(--radius-sub)] border border-border-strong bg-card px-3.5 py-3 text-[13px] text-fg outline-none transition-colors placeholder:text-dim-fg focus:border-accent"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </OnboardingField>

            <OnboardingField
              label="Department"
              accentHint={
                previewHub
                  ? `Routes to the ${previewHub.label}.`
                  : "Pick or type. Drives which hub you land in."
              }
            >
              <div className="mb-2.5 flex flex-wrap gap-[7px]">
                {QUICK_PICKS.map((q) => {
                  const active = department.toLowerCase() === q.toLowerCase();
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setDepartment(q)}
                      className="rounded-full border px-[13px] py-1.5 uppercase tracking-[0.5px] transition-colors"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        borderColor: active
                          ? "var(--accent)"
                          : "var(--border-strong)",
                        background: active ? "var(--accent-dim)" : "transparent",
                        color: active ? "var(--accent)" : "var(--muted-fg)",
                      }}
                    >
                      {q}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. QA"
                className="w-full rounded-[var(--radius-sub)] border border-border-strong bg-card px-3.5 py-3 text-[14.5px] text-fg outline-none transition-colors placeholder:text-dim-fg focus:border-accent"
              />
            </OnboardingField>

            <div className="mt-1.5 flex items-center gap-3.5">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-[var(--radius-sub)] px-[22px] py-3 text-[11px] font-bold uppercase tracking-[1px] transition-opacity disabled:opacity-60"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--accent)",
                  color: "var(--accent-on)",
                }}
              >
                {submitting ? "Saving…" : "Continue →"}
              </button>
              {previewHub ? (
                <span
                  className="text-[12px]"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--muted-fg)",
                  }}
                >
                  → {previewHub.label}
                </span>
              ) : null}
            </div>
          </form>
        </div>

        <div
          className="mt-[42px] border-t border-border pt-4 text-[10.5px]"
          style={{ fontFamily: "var(--font-mono)", color: "var(--dim-fg)" }}
        >
          Signed in as {user.email}. This is a one-time setup; you won't see
          it again on this device.
        </div>
      </div>
    </main>
  );
}

function OnboardingField({ label, hint, accentHint, children }) {
  return (
    <label className="block">
      <span
        className="uppercase tracking-[1.5px] text-fg"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      {/* Accent hint sits ABOVE the control (reference Department field). */}
      {accentHint ? (
        <span
          className="mb-[9px] mt-1.5 block text-[12px] text-accent"
          style={{ color: "var(--accent)" }}
        >
          {accentHint}
        </span>
      ) : null}
      <div className="mt-2">{children}</div>
      {hint ? (
        <span className="mt-1.5 block text-[12px] leading-[1.5] text-dim-fg">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Best-effort hub preview — runs the same lookup the server runs.
 * Kept local (no hook needed) so the input field updates the preview
 * synchronously on every keystroke.
 */
function previewHubForDepartment(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const norm = value.trim().toLowerCase();
  for (const hub of Object.values(HUBS)) {
    if (hub.departments.includes(norm)) return hub;
  }
  return null; // Server falls back to DEFAULT_HUB_ID; we just don't preview that case.
}
