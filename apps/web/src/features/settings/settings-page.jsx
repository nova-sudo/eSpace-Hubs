"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, PageHeader, SegmentedControl } from "@/components/ui";
import { useSession } from "@/features/auth";
import { useActiveHub, useHubLink } from "@/features/hubs";
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
        subtitle:
          "Provider tokens are encrypted at rest and only ever used to fetch your own data. Goals, check-ins, and grades are stored in your account so they follow you across devices.",
      }
    : {
        crumb: "Settings · your account",
        title: "Your account.",
        subtitle:
          "Manage your sign-in, security, and account. Org configuration lives under Hubs.",
      };

  return (
    <main className="relative z-[2] px-4 sm:px-10 pb-14 pt-9">
      <PageHeader
        crumb={header.crumb}
        title={header.title}
        subtitle={header.subtitle}
        right={
          <Link href={link("")}>
            <Button variant="ghost">
              <ArrowLeft size={15} />
              Home
            </Button>
          </Link>
        }
      />

      {/* #239: real tab semantics via SegmentedControl (role="tablist" /
          role="tab" + aria-selected), so the selected state isn't
          conveyed by styling alone. */}
      <div className="mb-6">
        <SegmentedControl
          options={tabs.map(({ id, label }) => ({ value: id, label }))}
          value={activeTab.id}
          onChange={setTab}
        />
      </div>
      <div role="tabpanel" id={`settings-panel-${activeTab.id}`}>
        <ActivePanel />
      </div>
    </main>
  );
}
