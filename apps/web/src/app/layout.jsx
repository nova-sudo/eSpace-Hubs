import "./globals.css";
import { Toaster } from "sonner";
import { SessionProvider } from "@/features/auth";
import { CompanionApiOriginProvider } from "@/features/companion";
import { MigrateOnce } from "@/features/migrate";
import { HubsFetcher } from "@/features/hubs";
import { JobsToast } from "@/components/shell/jobs-toast";

// Fonts (Manrope + JetBrains Mono) load via the <link> in <head> below —
// see docs/design-system-v2.md.

export const metadata = {
  title: "eSpace Dev Hub",
  description:
    "A personal performance dashboard and evidence tracker for eSpace engineers.",
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the no-flash script below sets data-theme on
    // the client before hydration, so the <html> attribute intentionally
    // differs from the SSR markup (which has none). Scoped to this one element.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Design system v2 fonts. Loaded via <link> (not a CSS @import) because
            an @import in globals.css lands after Tailwind's expansion and the
            browser drops it. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* No-flash theme: apply the theme before hydration so the first paint
            matches. Light is the default; a saved "dark" paints dark; a saved
            "system" (or nothing) follows prefers-color-scheme. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('espace-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}",
          }}
        />
        {/* SessionProvider kicks off the initial /auth/me lookup so
            useSession() reads from a populated store on first render.
            It's a no-op when the user has no cookie (returns 401 →
            user: null, loading: false). */}
        <SessionProvider>
          {/* Drives the api-origin store — fetches /me/api-origin on
              session establishment, then refreshes every 60s and on
              tab focus so the header chip flips within a heartbeat
              window of the companion going up/down. Side-effect only;
              doesn't gate children. */}
          <CompanionApiOriginProvider />
          {/* MigrateOnce runs the first-session localStorage→API upload
              for devices that carry pre-M7 legacy data. It's silent
              on devices with no legacy data and idempotent on the
              server side. Reads the raw legacy localStorage keys
              directly, so it's independent of the now API-direct
              feature stores. */}
          <MigrateOnce />
          {/* M10.1: fetches /api/v1/hubs/me once per authenticated
              session into the hubs store. The hub layout
              (app/[hub]/layout.jsx) and the root redirect read from
              that store synchronously. */}
          <HubsFetcher />
          {/* All feature stores are now API-direct: goals, grading,
              snapshots, evidence, goal-specs, goal-context, and
              goal-inputs each self-hydrate inside their consuming hooks
              on session establishment — no standalone <*Sync /> mounts. */}
          {children}
        </SessionProvider>
        {/* Headless: keeps a single persistent toast in sync with the
            in-memory jobs store so background analysis / tier-grading stays
            visible across navigation. Sibling of <Toaster>, never unmounts. */}
        <JobsToast />
        <Toaster
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--card)",
              border: "none",
              boxShadow: "var(--shadow-float)",
              color: "var(--fg)",
              borderRadius: "var(--radius-lg)",
              fontSize: 13,
              fontWeight: 500,
            },
          }}
        />
      </body>
    </html>
  );
}
