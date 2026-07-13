"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, PageHeader } from "@/components/ui";
import { useSession } from "@/features/auth";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { cn } from "@/lib/cn";
import {
  AccountTab,
  CompanionTab,
  DangerTab,
  IntegrationsTab,
  OnboardingTab,
  QaConfigTab,
  SnapshotsPrefsTab,
} from "./tabs";

// `hubFilter` makes a tab hub-scoped — only shown when the active
// hub's id matches. `engagementFilter` is analogous: a tab opt-in for
// users whose `engagement` matches (e.g. Crealogix-only Companion
// tab). `hubVisible(hub)` is a capability predicate — used to keep
// dev goal-tracking tabs (paste-your-goals onboarding, provider
// integrations, snapshot cadence/privacy) out of hubs that don't have
// those surfaces (e.g. admin, which has no goals/snapshots slots and an
// empty `allowedIntegrations`). Tabs without any filter show universally.
const ALL_TABS = [
  {
    id: "onboarding",
    label: "Onboarding",
    Component: OnboardingTab,
    // Pasting L1/L2 goals only makes sense where the hub tracks goals.
    hubVisible: (h) => Boolean(h?.pages?.goals),
  },
  {
    id: "integrations",
    label: "Integrations",
    Component: IntegrationsTab,
    // Only hubs that actually consume provider tokens (dev/qa/manager).
    hubVisible: (h) => (h?.allowedIntegrations?.length ?? 0) > 0,
  },
  {
    id: "qa-config",
    label: "QA Hub config",
    Component: QaConfigTab,
    hubFilter: "qa",
  },
  {
    id: "companion",
    label: "Companion",
    Component: CompanionTab,
    engagementFilter: "crealogix",
  },
  { id: "account", label: "Account", Component: AccountTab },
  {
    id: "snapshots",
    label: "Snapshots & privacy",
    Component: SnapshotsPrefsTab,
    // Snapshot cadence/privacy is the dev goal-cycle-history feature.
    hubVisible: (h) => Boolean(h?.pages?.snapshots),
  },
  { id: "danger", label: "Danger zone", Component: DangerTab },
];

export function SettingsPage() {
  const activeHub = useActiveHub();
  const { user } = useSession();
  const tabs = useMemo(
    () =>
      ALL_TABS.filter((t) => {
        if (t.hubFilter && !(activeHub && t.hubFilter === activeHub.id)) {
          return false;
        }
        if (t.engagementFilter && t.engagementFilter !== (user?.engagement ?? "espace")) {
          return false;
        }
        if (t.hubVisible && !t.hubVisible(activeHub)) {
          return false;
        }
        return true;
      }),
    [activeHub, user?.engagement],
  );

  const [tab, setTab] = useState("onboarding");
  // If the user lands on /qa/settings, then switches hub, the QA tab
  // disappears — fall back to the first visible tab so we never try
  // to render an undefined component.
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0];
  const ActivePanel = activeTab.Component;
  const link = useHubLink();

  // The token/privacy framing only fits hubs that consume provider tokens.
  // On a hub without integrations (admin), settings is just personal
  // account + security, so the header speaks to that instead.
  const hasIntegrations = (activeHub?.allowedIntegrations?.length ?? 0) > 0;
  const header = hasIntegrations
    ? {
        crumb: "Settings · your tokens, your data",
        title: "Your keys. Your terms.",
        italicWord: "terms",
        subtitle:
          "Everything lives in your browser. We never see your tokens, and your metrics never leave this tab unless you export them.",
      }
    : {
        crumb: "Settings · your account",
        title: "Your account.",
        italicWord: "account",
        subtitle:
          "Manage your sign-in, security, and account. Org configuration lives under Hubs.",
      };

  return (
    <main className="relative z-[2] px-10 pb-14 pt-9">
      <PageHeader
        crumb={header.crumb}
        title={header.title}
        italicWord={header.italicWord}
        subtitle={header.subtitle}
        right={
          <Link href={link("")}>
            <Button variant="ghost">← Dashboard</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-8">
        <nav className="sticky top-20 flex flex-col gap-0.5">
          {tabs.map(({ id, label }) => {
            const active = activeTab.id === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "cursor-pointer px-3.5 py-2.5 text-left uppercase tracking-[0.5px] transition-colors",
                  active
                    ? "bg-accent-dim text-accent"
                    : "bg-transparent text-fg hover:bg-accent-dim/50",
                )}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  borderLeft: active
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>
        <div>
          <ActivePanel />
        </div>
      </div>
    </main>
  );
}
