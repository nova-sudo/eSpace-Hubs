"use client";

import { Check, ChevronRight, X } from "lucide-react";
import { Badge, Card, Label, Section } from "@/components/ui";
import { PROVIDERS, useIntegrations } from "@/features/integrations";
import { GoalsEditor } from "@/features/goals";

/**
 * Onboarding tab — a one-pager walkthrough for new users.
 *
 * Two sections:
 *   1. Integration status — compact list with Connect CTAs that deep-link
 *      into the Integrations tab for the actual auth flow.
 *   2. Goal tree editor — the L1 / L2 hierarchy the user maintains locally.
 *
 * We intentionally don't duplicate the full provider-card UI here; that's
 * the Integrations tab's job. This is a lightweight "are you set up?" view.
 */
export function OnboardingTab() {
  return (
    <div className="flex flex-col gap-8">
      <Section title="Connect your integrations">
        <IntegrationSummary />
      </Section>

      <Section title="Map your L1 / L2 goals">
        <div className="flex flex-col gap-4">
          <p className="max-w-2xl text-[13px] leading-[1.55] text-muted-fg">
            We don&apos;t pull goals from Zoho — role permissions block the
            API and the tree rarely changes anyway. Paste them in once here
            and the dashboard will render them grouped by L1. Edit at review
            time.
          </p>
          <Card className="p-6">
            <GoalsEditor />
          </Card>
        </div>
      </Section>
    </div>
  );
}

function IntegrationSummary() {
  const { isConnected, integrations, connectedProviders } = useIntegrations();
  const totalProviders = Object.keys(PROVIDERS).length;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <Label>
          {connectedProviders.length} of {totalProviders} connected
        </Label>
        <button
          type="button"
          onClick={() => {
            // Settings page owns the tab state; we can't change it directly
            // from here without a context, so we just scroll the user to the
            // nav and let them click. Cheap and works.
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="inline-flex items-center gap-1 text-[12.5px] font-bold text-fg hover:underline"
        >
          Manage
          <ChevronRight size={13} />
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {Object.values(PROVIDERS).map((p) => {
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
                  <div className="text-[11px] text-dim-fg">
                    {connected && meta?.username
                      ? `@${meta.username}`
                      : p.description}
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
