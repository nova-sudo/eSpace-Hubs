"use client";

import { AnalystPage, AnalystProvider, useAnalyst } from "@/features/analyst";
import { CommandPalette, useGlobalShortcuts } from "@/features/command-palette";
import { BackfillBanner, useAutoSnapshot } from "@/features/snapshots";
import { SPEC_KIND_META, SPEC_VARIANTS, useGoalSpecs } from "@/features/goal-specs";
import { useActiveHub } from "@/features/hubs";
import { PageWidth } from "@/components/ui";
import { Header } from "./header";
import { Footer } from "./footer";

/**
 * Top-level page chrome — grain overlay, sticky header, optional footer.
 *
 * Hosts the AI Analyst overlay: when the header's activator flips the
 * shared `useAnalyst().open`, the dashboard view translates left and the
 * `<AnalystPage />` (fixed sibling) translates in from the right.
 *
 * Chat still exists as a secondary mode inside the analyst page — see
 * `@/features/analyst/analyst-chat-mode.jsx`. The old standalone
 * ChatProvider / ChatPage / ChatActivator remain in `@/features/chat` for
 * direct use if needed, but the primary experience is now goal analysis.
 */
export function AppShell({ children, hideFooter = false }) {
  return (
    <AnalystProvider>
      <AppShellInner hideFooter={hideFooter}>{children}</AppShellInner>
    </AnalystProvider>
  );
}

function AppShellInner({ children, hideFooter }) {
  const { open } = useAnalyst();
  // The snapshot / backfill machinery is the DEV goal-cycle-history feature.
  // The goal + snapshot stores are per-user, NOT hub-scoped, so mounting this
  // chrome on every hub leaked the backfill banner (and weekly auto-capture,
  // plus its integration fetches) into admin/qa/manager for a multi-hub user.
  // Gate it on the active hub actually exposing the `snapshots` surface —
  // only the dev hub does today. A null hub (non-hub AppShell usage) is
  // treated as "no snapshots", which is correct.
  const hub = useActiveHub();
  const tracksSnapshots = Boolean(hub?.pages?.snapshots);
  // Hook the global keyboard shortcuts (1-6, j/k, g+x chords). The palette's
  // own ⌘K / ? listener lives inside the palette component.
  useGlobalShortcuts();
  return (
    <>
      {/* Everything that should swipe off left when the analyst opens
          lives inside this wrapper. We transform the wrapper rather than
          the `body` so sticky headers inside continue to work (sticky
          needs a scrolling ancestor, and `transform` on `body` would
          break that). */}
      <div
        className="relative z-[2]"
        aria-hidden={open ? "true" : undefined}
        // React 19 treats an empty string for boolean attrs as `false`
        // and warns. Pass real boolean `true` when we want the shell
        // inert (analyst overlay open), and `undefined` to omit the
        // attribute entirely otherwise.
        inert={open || undefined}
        style={{
          transform: open ? "translateX(-100%)" : "translateX(0)",
          transition: "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {/* Backfill banner sits above the header. Self-hides when the
            snapshot store has every completed Sun → Thu week of the
            current year already covered. Gated to snapshot-tracking hubs
            (dev) so it never surfaces in admin/qa/manager. */}
        {tracksSnapshots ? <BackfillBannerGate /> : null}
        <Header />
        <div>{children}</div>
        {hideFooter ? null : (
          <PageWidth>
            <Footer />
          </PageWidth>
        )}
      </div>
      {/* The analyst overlay loads the dev goal tree (goals, specs, spec
          meta) on mount; only hubs exposing the analyst (dev) can open it —
          its activator in the header is gated the same way — so don't pay
          for those loads on manager/admin/qa. */}
      {hub?.pages?.analyst ? <AnalystPage /> : null}
      {/* Mounted last so it floats above the analyst overlay; uses fixed
          positioning + z-100 to clear every other layer including the grain.
          Its snapshot hooks are lazy (nothing fetched until "Snapshot now"
          runs) and its history load is gated to hubs with a snapshots page. */}
      <CommandPalette />
      {/* Auto-snapshotter — captures one snapshot per completed Sun → Thu
          work-week (idempotent). Wrapped in a child component and mounted
          only for snapshot-tracking hubs, so outside dev the hook — and the
          integration fetches it drives — never runs at all. */}
      {tracksSnapshots ? <AutoSnapshotRunner /> : null}
    </>
  );
}

/**
 * Mount the backfill banner only once the user has something to backfill.
 * A brand-new account (zero goals, or only auto-tracked ones) was greeted
 * with "38 weeks missing — backfill…" before it had a single check-in to
 * miss. Backfill synthesises MANUAL readings, so the gate is: at least one
 * classified manual / hybrid tracker.
 */
function BackfillBannerGate() {
  const { specs, fetched } = useGoalSpecs();
  if (!fetched) return null;
  let hasManualTracker = false;
  for (const spec of specs.values()) {
    if (SPEC_KIND_META[spec?.widget]?.variant !== SPEC_VARIANTS.AUTO) {
      hasManualTracker = true;
      break;
    }
  }
  return hasManualTracker ? <BackfillBanner /> : null;
}

/**
 * Headless runner for the weekly auto-snapshot. Isolated into its own
 * component so it can be conditionally MOUNTED (React hook rules forbid
 * conditionally CALLING useAutoSnapshot). Mounted only where the active
 * hub tracks snapshots; unmounted everywhere else.
 */
function AutoSnapshotRunner() {
  useAutoSnapshot();
  return null;
}
