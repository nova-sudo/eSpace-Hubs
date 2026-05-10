"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";
import { Button, Card, MonoLabel, Section } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PROVIDERS, useIntegrations } from "@/features/integrations";
import { GoalsEditor } from "@/features/goals";
import { setDemoMode, useDemoMode } from "@/features/demo-mode";

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
    <>
      <Section num="01 /" title="Connect your integrations">
        <IntegrationSummary />
      </Section>

      <Section num="02 /" title="Try it with demo data">
        <DemoModeCard />
      </Section>

      <Section num="03 /" title="Map your L1 / L2 goals">
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
    </>
  );
}

/**
 * Demo-mode toggle. Renders the consequences plainly so toggling never
 * feels mysterious: which 14 PRs, what spread, where they show up.
 */
function DemoModeCard() {
  const demo = useDemoMode();
  return (
    <Card className="p-6">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div>
          <MonoLabel>{demo ? "Demo mode is ON" : "Demo mode is OFF"}</MonoLabel>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-[1.55]">
            Loads a deterministic synthetic dataset — 14 PRs across 4 repos,
            comments from 4 reviewers spread over the last 90 days — so you
            can see the dashboard&apos;s review-timing section, the{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>/reviews</code>{" "}
            page, and every metric tile populated with realistic data. No
            tokens needed; no real API calls fire while it&apos;s on.
          </p>
          <ul className="mt-3 grid gap-1 text-[12px] text-muted-fg md:grid-cols-2">
            <li>· TTFR ranging from minutes to days</li>
            <li>· ATTNR varying per PR</li>
            <li>· Mix of merged + still-open PRs</li>
            <li>· Real diff hunks on review comments</li>
            <li>· Activity heatmap with weekday-realistic shape</li>
            <li>· 5-reviewer high-turnover PR for stress-test</li>
          </ul>
          <p className="mt-3 max-w-2xl text-[12px] text-muted-fg">
            A blue banner stays pinned at the top while demo mode is on so
            you can&apos;t mistake demo data for real metrics. One click on
            that banner — or the button here — flips back to live data.
          </p>
        </div>
        <div className="md:pt-1">
          <Button
            onClick={() => setDemoMode(!demo)}
            variant={demo ? "ghost" : undefined}
          >
            {demo ? "Turn demo off" : "Turn demo on"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function IntegrationSummary() {
  const { isConnected, integrations, connectedProviders } = useIntegrations();
  const totalProviders = Object.keys(PROVIDERS).length;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <MonoLabel>
          {connectedProviders.length} of {totalProviders} connected
        </MonoLabel>
        <Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // Settings page owns the tab state; we can't change it directly
            // from here without a context, so we just scroll the user to the
            // nav and let them click. Cheap and works.
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="text-[11px] uppercase tracking-[0.4px] text-accent"
          style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
        >
          Manage ↗
        </Link>
      </div>
      <ul className="flex flex-col gap-2">
        {Object.values(PROVIDERS).map((p) => {
          const connected = isConnected(p.id);
          const meta = integrations[p.id];
          return (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-[var(--radius-sub)] border border-border bg-card-alt px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-sub)] bg-accent-dim font-bold text-accent"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                >
                  {p.glyph}
                </span>
                <div>
                  <div className="text-[13px] font-semibold">{p.label}</div>
                  <div
                    className="text-dim-fg"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
                  >
                    {connected && meta?.username
                      ? `@${meta.username}`
                      : p.description}
                  </div>
                </div>
              </div>
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.4px]",
                  connected
                    ? "bg-accent-dim text-good"
                    : "bg-[rgba(0,0,0,0.04)] text-muted-fg",
                )}
                style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}
              >
                {connected ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {connected ? "Connected" : "Not connected"}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
