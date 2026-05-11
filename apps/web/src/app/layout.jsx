import "./globals.css";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { SessionProvider } from "@/features/auth";
import { GradingSync } from "@/features/grading";
import { SnapshotsSync } from "@/features/snapshots";
import { ContextSync } from "@/features/goal-context";
import { InputsSync } from "@/features/goal-inputs";
import { SpecsSync } from "@/features/goal-specs";
import { GoalsSync } from "@/features/goals";
import { MigrateOnce } from "@/features/migrate";

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
            user: null, loading: false).
            GradingSync sits inside the provider so it can read
            useSession() — it pulls the user's verdict cache from
            the API once on session establishment, merging into
            localStorage. M7.2 mirror-mode rollout. */}
        <SessionProvider>
          {/* MigrateOnce runs the first-session localStorage→API upload
              for devices that carry pre-M7 legacy data. It's silent
              on devices with no legacy data and idempotent on the
              server side. Sits alongside the per-store <*Sync /> pulls,
              which only replace local state when the server has
              content — so the pull/migrate race is safe. */}
          <MigrateOnce />
          <GradingSync />
          <SnapshotsSync />
          <ContextSync />
          <InputsSync />
          <SpecsSync />
          <GoalsSync />
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
