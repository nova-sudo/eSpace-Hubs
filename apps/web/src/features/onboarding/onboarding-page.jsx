"use client";

/**
 * M-OB — the post-login, pre-hub onboarding form.
 *
 * Captures three fields once after first login:
 *   - displayName  (pre-filled from invite) — required
 *   - department   (free text) — required. An org-chart / profile
 *                    attribute only — post-M-CAP, hub access comes from
 *                    the user's ROLES, assigned by an admin at invite or
 *                    approval time, NOT from this field. Don't imply
 *                    otherwise in the copy below; that used to be true
 *                    pre-M-CAP and the UI drifted from the backend once
 *                    it changed.
 *   - employeeId   (free text; informal, until Zoho lands) — optional,
 *                    matching the Account tab.
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
import { Check } from "lucide-react";
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

/**
 * The real chain the user is walking, not a bar that's always full:
 * Security (TOTP, already done to be here) → Profile → optional
 * Companion (Crealogix) → Approval (self-signups only; invited users
 * are already `active`).
 */
function StepChain({ steps, current }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px]">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-pill)] px-1.5 text-[11px] font-bold",
                done
                  ? "bg-mint text-mint-ink"
                  : active
                    ? "bg-ink text-ink-on"
                    : "bg-card-alt text-muted-fg",
              )}
              aria-hidden="true"
            >
              {done ? <Check size={11} /> : i + 1}
            </span>
            <span
              className={cn(
                "font-semibold",
                active ? "text-fg" : done ? "text-muted-fg" : "text-muted-fg",
              )}
              aria-current={active ? "step" : undefined}
            >
              {s}
            </span>
            {i < steps.length - 1 ? (
              <span className="text-dim-fg" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function QuickPick({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
        active ? "bg-ink text-ink-on" : "bg-card-alt text-muted-fg hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

function RequiredMark() {
  return (
    <span className="text-peach-text" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <div id={id} role="alert" className="mt-1 text-[12px] font-semibold text-peach-text">
      {children}
    </div>
  );
}

export function OnboardingPage() {
  const router = useRouter();
  const { user, loading, refreshSilent, logout } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState("profile"); // "profile" | "companion"
  const requiresCompanion = user?.engagement === "crealogix";
  const needsApproval = user?.status === "pending_admin";

  const steps = [
    "Security",
    "Profile",
    ...(requiresCompanion ? ["Companion"] : []),
    ...(needsApproval ? ["Approval"] : []),
  ];
  const currentStep = step === "companion" ? 2 : 1;

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
      // the stale "incomplete" state and bounce us back here. Silent
      // so the guard doesn't blank the page mid-redirect.
      await refreshSilent();
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

  function validate() {
    const next = {};
    if (!displayName.trim()) next.displayName = "Enter the name you'd like shown.";
    if (!department.trim()) next.department = "Pick a chip or type your department.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
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
          title="Welcome to eSpace Hubs"
          subtitle="A few quick fields so we know how to route you. You can change them later under Settings → Account — there's no wrong answer here."
        />

        <Card padding={28}>
          <StepChain steps={steps} current={currentStep} />

          {step === "companion" ? (
            <CompanionGateStep
              submitting={submitting}
              onContinue={submitOnboarding}
              onBack={() => setStep("profile")}
            />
          ) : (
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
              <div>
                <Field
                  label={
                    <>
                      Display name
                      <RequiredMark />
                    </>
                  }
                  hint="Shown in the header and to your manager."
                >
                  <Input
                    type="text"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      if (errors.displayName) setErrors((p) => ({ ...p, displayName: null }));
                    }}
                    placeholder="Your name"
                    autoComplete="name"
                    required
                    aria-required="true"
                    aria-invalid={errors.displayName ? "true" : undefined}
                    aria-describedby={errors.displayName ? "onboarding-displayName-error" : undefined}
                  />
                </Field>
                <FieldError id="onboarding-displayName-error">{errors.displayName}</FieldError>
              </div>

              {/* Department: the chips live OUTSIDE the <label> on purpose.
                  Field wraps its children in a <label>, so a click on the
                  label text used to activate the first chip ("Engineering")
                  instead of focusing the input. */}
              <div>
                <Label as="label" htmlFor="onboarding-department" className="mb-1.5 block">
                  Department
                  <RequiredMark />
                </Label>
                <div className="mb-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Common departments">
                  {QUICK_PICKS.map((q) => (
                    <QuickPick
                      key={q}
                      label={q}
                      active={department.toLowerCase() === q.toLowerCase()}
                      onClick={() => {
                        setDepartment(q);
                        if (errors.department) setErrors((p) => ({ ...p, department: null }));
                      }}
                    />
                  ))}
                </div>
                <Input
                  id="onboarding-department"
                  type="text"
                  value={department}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    if (errors.department) setErrors((p) => ({ ...p, department: null }));
                  }}
                  placeholder="e.g. QA"
                  required
                  aria-required="true"
                  aria-invalid={errors.department ? "true" : undefined}
                  aria-describedby={errors.department ? "onboarding-department-error" : "onboarding-department-hint"}
                />
                <div id="onboarding-department-hint" className="mt-1 text-[12px] leading-[1.4] text-muted-fg">
                  Pick or type. For your org chart — an admin assigns which hubs
                  you can use.
                </div>
                <FieldError id="onboarding-department-error">{errors.department}</FieldError>
              </div>

              <Field
                label="Employee ID"
                hint="Optional. Whatever your HR system calls it — you can add it later under Settings → Account."
              >
                <Input
                  type="text"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="e.g. EMP-1042"
                />
              </Field>

              <div className="mt-1 flex items-center gap-3">
                <Button type="submit" size="lg" disabled={submitting}>
                  {submitting ? "Saving…" : requiresCompanion ? "Continue" : "Finish setup"}
                </Button>
                <span className="text-[12px] text-muted-fg">
                  <RequiredMark /> required
                </span>
              </div>
            </form>
          )}
        </Card>

        <div className="mt-6 text-center text-[13px] text-muted-fg">
          Signed in as {user.email} ·{" "}
          <button
            type="button"
            onClick={() => logout()}
            className="font-bold text-fg hover:underline"
          >
            Sign out
          </button>
          <div className="mt-1">
            This is a one-time setup saved to your account — you won&apos;t see
            it again on any device.
          </div>
        </div>
      </div>
    </main>
  );
}
