import "./globals.css";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { SessionProvider } from "@/features/auth";
import { CompanionApiOriginProvider } from "@/features/companion";
import { MigrateOnce } from "@/features/migrate";
import { HubsFetcher } from "@/features/hubs";

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata = {
  title: "eSpace Dev Hub",
  description:
    "A personal performance dashboard and evidence tracker for eSpace engineers.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body>
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
        <Toaster
          theme="light"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--card)",
              border: "1px solid var(--border-strong)",
              color: "var(--fg)",
              borderRadius: "4px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            },
          }}
        />
      </body>
    </html>
  );
}
