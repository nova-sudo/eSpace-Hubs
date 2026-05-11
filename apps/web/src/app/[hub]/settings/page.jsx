import { AppShell } from "@/components/shell/app-shell";
import { SettingsPage } from "@/features/settings";

export default function Page() {
  return (
    <AppShell>
      <SettingsPage />
    </AppShell>
  );
}
