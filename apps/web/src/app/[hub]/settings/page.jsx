import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { SettingsPage } from "@/features/settings";

export default function Page() {
  return (
    <AppShell>
      {/* SettingsPage reads `?tab=` via useSearchParams, which needs a
          Suspense boundary above it for the build's prerender pass. */}
      <Suspense fallback={null}>
        <SettingsPage />
      </Suspense>
    </AppShell>
  );
}
