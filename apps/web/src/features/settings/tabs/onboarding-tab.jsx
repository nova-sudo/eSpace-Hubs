"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { Badge, Card, Label, Section } from "@/components/ui";
import { providerDescription, useIntegrations } from "@/features/integrations";
import { useAllowedProviders } from "@/features/hubs";
import { useSession } from "@/features/auth";
import { GoalsEditor, useGoals } from "@/features/goals";

/**
 * "Goals & setup" tab (settings tab id `goals`; the file keeps its
 * historical name) — the returning user's home for the goals editor,
 * with a compact "are you set up?" integration summary on top.
 *
 * Two sections, goals FIRST (review-ux-flows R8 — "Add or import goals"
 * lands here on first run, and the editor used to sit below the fold):
 *   1. Goal tree editor — the objectives and goals the user maintains.
 *   2. Integration status — compact list with a Manage link that
 *      switches to the Integrations tab for the actual auth flow.
 *
 * We intentionally don't duplicate the full provider-card UI here; that's
 * the Integrations tab's job.
 */
export function OnboardingTab({ onSwitchTab }) {
  return (
    <div className="flex flex-col gap-8">
      <FirstRunWelcome />
      <div>
        <div className="flex flex-col gap-4">
          <p className="max-w-2xl text-[13px] leading-[1.55] text-muted-fg">
            An objective is a heading from your performance plan; the goals
            under it are what you&apos;re measured on. Import the sheet you
            were given, or add them by hand — they appear on the Goals page
            grouped by objective. You can edit them at review time.
          </p>
          <Card className="p-6">
            <GoalsEditor />
          </Card>
        </div>
      </div>

      <Section title="Connect your integrations">
        <IntegrationSummary onManage={() => onSwitchTab?.("integrations")} />
      </Section>
    </div>
  );
}

/**
 * First run only (no goals yet): say who they report to and what to do
 * first (review-ux-flows R8). Disappears once the first objective exists.
 */
function FirstRunWelcome() {
  const { user } = useSession();
  const { total } = useGoals();
  const hasGoals = (total?.l1s || 0) + (total?.l2s || 0) > 0;
  if (!user || hasGoals) return null;
  const first = (user.displayName || "").trim().split(/\s+/)[0] || "there";
  const manager = user.manager?.displayName;
  return (
    <Card tone="sky" className="p-5">
      <p className="text-[15px] font-bold">You&apos;re in, {first}.</p>
      <p className="mt-1 max-w-2xl text-[13px] leading-[1.55]">
        {manager ? (
          <>
            Your manager is <span className="font-semibold">{manager}</span> — they approve
            the trackers you build and read the review packets you send.
          </>
        ) : (
          <>
            No manager is assigned to you yet — ask your admin. Until then, trackers you
            build go to the admins for approval.
          </>
        )}{" "}
        Start by adding the goals from your review document below.
      </p>
    </Card>
  );
}

function IntegrationSummary({ onManage }) {
  const { isConnected, integrations } = useIntegrations();
  const { user } = useSession();
  // Only the providers THIS hub can connect — Jenkins is in the
  // catalog but a Dev hub user can't connect it, so counting it made
  // "3 of 4" unreachable.
  const providers = useAllowedProviders();
  const connectedCount = providers.filter((p) => isConnected(p.id)).length;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <Label>
          {connectedCount} of {providers.length} connected
        </Label>
        <button
          type="button"
          onClick={onManage}
          className="link-target inline-flex items-center gap-1 text-[12.5px] font-bold text-fg hover:underline"
        >
          Manage
          <ChevronRight size={13} />
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {providers.map((p) => {
          const connected = isConnected(p.id);
          const meta = integrations[p.id];
          return (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-[var(--radius-lg)] bg-card-alt px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-card text-[11px] font-bold text-fg">
                  {p.glyph}
                </span>
                <div>
                  <div className="text-[13px] font-semibold text-fg">{p.label}</div>
                  <div className="text-[11px] text-muted-fg">
                    {connected && meta?.username
                      ? `@${meta.username}`
                      : providerDescription(p, user?.engagement)}
                  </div>
                </div>
              </div>
              <Badge tone={connected ? "mint" : "neutral"}>
                {connected ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {connected ? "Connected" : "Not connected"}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
