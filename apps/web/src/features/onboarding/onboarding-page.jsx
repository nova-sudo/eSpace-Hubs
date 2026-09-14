"use client";

/**
 * M-OB — the post-login, pre-hub onboarding form.
 *
 * Captures three fields once after first login:
 *   - displayName  (pre-filled from invite)
 *   - employeeId   (free text; informal, until Zoho lands)
 *   - department   (free text; an org-chart / profile attribute only —
 *                    post-M-CAP, hub access comes from the user's
 *                    ROLES, assigned by an admin at invite or approval
 *                    time, NOT from this field. Don't imply otherwise
 *                    in the copy below; that used to be true pre-M-CAP
 *                    and the UI drifted from the backend once it changed.)
 *
 * On submit the API:
 *   1. Persists the three fields on `users`.
 *   2. Returns the new PublicUser + a `redirectTo` computed from the
 *      user's EXISTING roles (not from department).
 *
 * The frontend then refreshes the session (so the AuthGuard sees the
 * new onboardingCompletedAt and stops redirecting here), and pushes
 * to `redirectTo`.
 *
 * Crealogix engagement — a second, gated step:
 *   Crealogix's private infra isn't reachable from Vercel, so those
 *   users must pair the desktop companion app before their account is
 *   usable. Rather than add a server-side "verified" flag, we simply
 *   defer the POST above (the thing that actually flips
 *   onboardingCompletedAt) until <CompanionGateStep> observes a live
 *   companion connection. The existing AuthGuard redirect is therefore
 *   the enforcement mechanism — no API changes needed.
 *
 * Renders on the app canvas (no header/nav) — it's a transitional
 * surface between authentication and the hub the user lands in.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button, Card, Field, Input, Label, Loading, PageHeader } from "@/components/ui";
import { useSession } from "@/features/auth";
import { resetHubsStore } from "@/features/hubs";
import { cn } from "@/lib/cn";
import { CompanionGateStep } from "./companion-gate-step.jsx";

// Common departments rendered as quick-pick chips above the free-text
// input. The registry knows about more (engineering/platform/backend/
// frontend/mobile/devops/sre for Dev; qa/quality-assurance/testing/
// quality for QA) but a short list keeps the picker calm. Free-text
// covers the rest.
const QUICK_PICKS = ["Engineering", "QA", "Platform", "DevOps", "Frontend"];

function ProgressStrip({ filled }) {
  return (
    <div className="mb-5 flex gap-1.5">
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 flex-1 rounded-[var(--radius-pill)]",
            i < filled ? "bg-ink" : "bg-card-alt",
          )}
        />
      ))}
    </div>
  );
}

function QuickPick({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
        active ? "bg-ink text-ink-on" : "bg-card-alt text-muted-fg hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

export function OnboardingPage() {
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState("profile"); // "profile" | "companion"
  const requiresCompanion = user?.engagement === "crealogix";
  const totalSteps = requiresCompanion ? 2 : 1;
  const stepNum = step === "companion" ? 2 : 1;

  // Pre-fill displayName from the existing session user once it
  // resolves. Setting state inside an effect (not directly in the
  // render) keeps the input controlled and editable.
  useEffect(() => {
    if (user?.displayName && !displayName) {
      setDisplayName(user.displayName);
    }
  }, [user, displayName]);

  async function submitOnboarding() {
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!displayName.trim() || !employeeId.trim() || !department.trim()) {
      toast.error("All three fields are required.");
      return;
    }
    // Crealogix users don't get onboarded yet — the profile POST (which
    // flips onboardingCompletedAt) waits until the companion step below
    // confirms a live connection.
    if (requiresCompanion) {
      setStep("companion");
      return;
    }
    await submitOnboarding();
  }

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg">
        <Loading label="Loading…" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-14 sm:px-10">
        <PageHeader
          crumb="One-time setup"
          title="Welcome to eSpace Dev Hub"
          subtitle="A few quick fields so we know how to route you. You can change them later from your profile — there's no wrong answer here."
        />

        <Card padding={28}>
          {totalSteps > 1 ? (
            <Label className="mb-2 block">{`Step ${stepNum} of ${totalSteps}`}</Label>
          ) : null}
          <ProgressStrip filled={Math.round((stepNum / totalSteps) * 6)} />

          {step === "companion" ? (
            <CompanionGateStep
              submitting={submitting}
              onContinue={submitOnboarding}
              onBack={() => setStep("profile")}
            />
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <Field label="Display name" hint="What we'll call you in the chrome.">
                <Input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </Field>

              <Field
                label="Employee ID"
                hint="Whatever your HR system calls it. Zoho will overwrite this later if it differs."
              >
                <Input
                  type="text"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="e.g. EMP-1042"
                />
              </Field>

              <Field
                label="Department"
                hint="Pick or type. For your org chart — an admin assigns which hub you land in."
              >
                <div className="mb-2.5 flex flex-wrap gap-1.5">
                  {QUICK_PICKS.map((q) => (
                    <QuickPick
                      key={q}
                      label={q}
                      active={department.toLowerCase() === q.toLowerCase()}
                      onClick={() => setDepartment(q)}
                    />
                  ))}
                </div>
                <Input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. QA"
                />
              </Field>

              <div className="mt-1 flex items-center gap-3">
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting ? "Saving…" : "Continue"}
                </Button>
              </div>
            </form>
          )}
        </Card>

        <div className="mt-6 text-center text-[13px] text-dim-fg">
          Signed in as {user.email}. This is a one-time setup saved to your
          account — you won&apos;t see it again on any device.
        </div>
      </div>
    </main>
  );
}
