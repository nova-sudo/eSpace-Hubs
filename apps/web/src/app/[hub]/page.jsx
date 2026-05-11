import { AppShell } from "@/components/shell/app-shell";
import { DashboardPage } from "@/features/dashboard";

// The dashboard reads `?range=<preset>` via useSearchParams, so Next.js
// must not attempt to statically prerender it.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <AppShell hideFooter>
      <DashboardPage />
    </AppShell>
  );
}
