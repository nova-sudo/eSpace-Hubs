"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button, PageContainer, PageHeader, SegmentedControl } from "@/components/ui";
import { useSession } from "@/features/auth";
import { useActiveHub, useHubLink } from "@/features/hubs";
import { NotificationPreferences } from "@/features/notifications";
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
// dev goal-tracking tabs (goals editor, provider integrations,
// snapshot cadence/privacy) out of hubs that don't have those
// surfaces (e.g. admin, which has no goals/snapshots slots and an
// empty `allowedIntegrations`). Tabs without any filter show universally.
//
// Tab ids are a public contract: other surfaces deep-link with
// `/settings?tab=<id>` (goals · integrations · account · notifications ·
// snapshots · danger · companion · qa-config). Don't rename an id without
// grepping for the link.
const ALL_TABS = [
  {
    id: "goals",
    label: "Goals & setup",
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
  // Every hub: per-kind mutes + the email switch (hub-audit §1.6/§3.4 —
  // also what keeps the manager hub's Settings from being just Account +
  // Danger zone).
  { id: "notifications", label: "Notifications", Component: NotificationPreferences },
  {
    id: "snapshots",
    label: "Snapshots & privacy",
    Component: SnapshotsPrefsTab,
    // Snapshot cadence/privacy is the dev goal-cycle-history feature.
    hubVisible: (h) => Boolean(h?.pages?.snapshots),
  },
  { id: "danger", label: "Danger zone", Component: DangerTab },
];

/** Page header per tab — the page is about whatever tab you opened. */
const TAB_HEADERS = {
  goals: {
    crumb: "Settings · goals & setup",
    title: "Your goals.",
    subtitle:
      "Add the objectives and goals from your performance plan — import the sheet you were given, or type them in. Each goal then gets a tracker on the Goals page.",
  },
  integrations: {
    crumb: "Settings · your tokens, your data",
    title: "Your keys. Your terms.",
    subtitle:
      "Provider tokens are encrypted at rest and only ever used to fetch your own data. Goals, check-ins, and grades are stored in your account so they follow you across devices.",
  },
  account: {
    crumb: "Settings · your account",
    title: "Your account.",
    subtitle: "Your name, sign-in and two-factor. Changes save to your account.",
  },
  notifications: {
    crumb: "Settings · notifications",
    title: "Notifications.",
    subtitle: "Choose what reaches your inbox and the bell, and whether we email you.",
  },
  snapshots: {
    crumb: "Settings · snapshots & privacy",
    title: "Snapshots & privacy.",
    subtitle: "How often your progress is captured, and who can read it.",
  },
  danger: {
    crumb: "Settings · danger zone",
    title: "Danger zone.",
    subtitle: "Irreversible actions on your own data. Each one asks before it runs.",
  },
};

// The pre-rename id keeps working for any stale bookmark.
const TAB_ALIASES = { onboarding: "goals" };

export function SettingsPage() {
  const activeHub = useActiveHub();
  const { user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  // `?tab=` is the source of truth: read on mount, written on change
  // (replace, not push — flipping tabs shouldn't fill the back stack).
  const requested = searchParams.get("tab");
  const [tab, setTabState] = useState(
    () => TAB_ALIASES[requested] ?? requested ?? "goals",
  );
  useEffect(() => {
    if (!requested) return;
    const resolved = TAB_ALIASES[requested] ?? requested;
    setTabState((current) => (current === resolved ? current : resolved));
  }, [requested]);

  const setTab = useCallback(
    (next) => {
      setTabState(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // If the user lands on /qa/settings, then switches hub, the QA tab
  // disappears — fall back to the first visible tab so we never try
  // to render an undefined component.
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0];
  const ActivePanel = activeTab.Component;
  const link = useHubLink();

  // The header speaks to the tab you're on (review-ux-flows R8/R16): a
  // first-run "Add or import goals" used to land under "Your keys. Your
  // terms." with integrations first. The token/privacy framing only fits
  // the Integrations tab now — and only on hubs that consume tokens.
  const hasIntegrations = (activeHub?.allowedIntegrations?.length ?? 0) > 0;
  const header = TAB_HEADERS[activeTab.id] ??
    (hasIntegrations
      ? TAB_HEADERS.integrations
      : {
          crumb: "Settings · your account",
          title: "Your account.",
          subtitle:
            "Manage your sign-in, security, and account. Org configuration lives under Hubs.",
        });

  return (
    <PageContainer>
      <PageHeader
        crumb={header.crumb}
        title={header.title}
        subtitle={header.subtitle}
        right={
          <Button as={Link} href={link("")} variant="ghost">
              <ArrowLeft size={15} />
              Home
            </Button>
        }
      />

      {/* #239: real tab semantics via SegmentedControl (role="tablist" /
          role="tab" + aria-selected), so the selected state isn't
          conveyed by styling alone. */}
      <div className="mb-6">
        <SegmentedControl ariaLabel="Settings sections"
          options={tabs.map(({ id, label }) => ({ value: id, label }))}
          value={activeTab.id}
          onChange={setTab}
        />
      </div>
      <div role="tabpanel" id={`settings-panel-${activeTab.id}`}>
        {/* Panels that need to jump to a sibling tab (Goals & setup →
            "Manage" → Integrations) get the setter instead of scrolling
            the user to the top and hoping. */}
        <ActivePanel onSwitchTab={setTab} />
      </div>
    </PageContainer>
  );
}
