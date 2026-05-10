import { AppShell } from "@/components/shell/app-shell";
import { GoalsTabPage } from "@/features/dashboard";

export default function Page() {
  return (
    <AppShell>
      <GoalsTabPage />
    </AppShell>
  );
}
