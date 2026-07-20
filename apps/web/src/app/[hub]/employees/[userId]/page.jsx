"use client";

/**
 * /[hub]/employees/:userId — one report's goal board.
 *
 * Only the `manager` hub exposes the employees slot; the slot guard
 * bounces users on other hubs back to their dashboard. The board itself
 * enforces the real authorization boundary server-side (the report must
 * be managerId === you), so a hand-typed id for someone else's report
 * returns "not on your team".
 */

import { useParams } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { ManagerEmployeeBoard } from "@/hubs/manager";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("employees");
  const params = useParams();
  if (!exposed) return null;
  const raw = params?.userId;
  const userId = Array.isArray(raw) ? raw[0] : (raw ?? null);
  return (
    <AppShell>
      <ManagerEmployeeBoard userId={userId} />
    </AppShell>
  );
}
