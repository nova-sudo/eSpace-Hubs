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
 *   - Full-bleed neutral background (no hub theme).
 *   - Large display type for the headline.
 *   - One single accent (warm sand) so it's clearly a transitional
 *     surface — not Dev's green, not QA's orange.
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

// Theme overrides — the form is its own visual surface, not a hub.
// Warm sand accent so it's clearly a transitional page.
const ONBOARDING_THEME = {
  "--accent": "#8a6b3c",
  "--accent-dim": "rgba(138,107,60,0.10)",
  "--accent-on": "#ffffff",
};

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
          background: "#f5f1e8",
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
      style={{
        minHeight: "100vh",
        background: "#f5f1e8",
        color: "#1c1c1c",
        ...ONBOARDING_THEME,
      }}
    >
      <div className="mx-auto grid min-h-screen max-w-3xl grid-rows-[1fr_auto] px-6 py-16">
        <div className="flex flex-col justify-center">
          <div
            className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(28,28,28,0.12)] px-3 py-1"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
          >
            <span
              className="block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            <span className="uppercase tracking-[0.5px] text-[#5a4a2c]">
              Step 1 of 1 · One-time setup
            </span>
          </div>

          <h1
            className="mb-3 font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 44,
              lineHeight: 1.05,
              letterSpacing: "-0.8px",
            }}
          >
            Welcome to <span style={{ fontStyle: "italic", color: "var(--accent)" }}>eSpace</span> Dev Hub.
          </h1>

          <p
            className="mb-10 max-w-xl text-[15px] leading-[1.55]"
            style={{ color: "#5a4a2c" }}
          >
            Three quick fields so we know how to route you. You can change
            them later from your profile — there's no wrong answer here.
          </p>

          <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-6">
            <Field label="Display name" hint="What we'll call you in the chrome.">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="w-full rounded-md border border-[rgba(28,28,28,0.16)] bg-white px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-[color:var(--accent)]"
              />
            </Field>

            <Field
              label="Employee ID"
              hint="Whatever your HR system calls it. Zoho will overwrite this later if it differs."
            >
              <input
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="e.g. EMP-1042"
                className="w-full rounded-md border border-[rgba(28,28,28,0.16)] bg-white px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-[color:var(--accent)]"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </Field>

            <Field
              label="Department"
              hint={
                previewHub
                  ? `Routes to the ${previewHub.label}.`
                  : "Pick or type. Drives which hub you land in."
              }
            >
              <div className="mb-2 flex flex-wrap gap-1.5">
                {QUICK_PICKS.map((q) => {
                  const active = department.toLowerCase() === q.toLowerCase();
                  return (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setDepartment(q)}
                      className="rounded-full border px-3 py-1 transition-colors"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        borderColor: active
                          ? "var(--accent)"
                          : "rgba(28,28,28,0.16)",
                        background: active ? "var(--accent-dim)" : "transparent",
                        color: active ? "var(--accent)" : "#5a4a2c",
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
                className="w-full rounded-md border border-[rgba(28,28,28,0.16)] bg-white px-3.5 py-2.5 text-[14px] outline-none transition-colors focus:border-[color:var(--accent)]"
              />
            </Field>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md px-5 py-2.5 text-[14px] font-semibold transition-opacity disabled:opacity-60"
                style={{
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
                    color: "#5a4a2c",
                  }}
                >
                  → {previewHub.label}
                </span>
              ) : null}
            </div>
          </form>
        </div>

        <div
          className="mt-12 border-t border-[rgba(28,28,28,0.08)] pt-4 text-[11px]"
          style={{ fontFamily: "var(--font-mono)", color: "#7a6a4c" }}
        >
          Signed in as {user.email}. This is a one-time setup; you won't see
          it again on this device.
        </div>
      </div>
    </main>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="uppercase tracking-[0.4px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          fontWeight: 700,
          color: "#3a2e18",
        }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[11.5px] leading-[1.5]" style={{ color: "#7a6a4c" }}>
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
