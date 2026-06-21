"use client";

/**
 * /[hub]/checkin — RETIRED. Filling now lives on the Goals page (per-widget
 * cadence stepper). This route stays only to redirect old bookmarks/links to
 * Goals. The check-in feature code is kept for now (reversible) but no longer
 * reachable from the UI.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHubLink } from "@/features/hubs";

export const dynamic = "force-dynamic";

export default function Page() {
  const link = useHubLink();
  const router = useRouter();
  useEffect(() => {
    router.replace(link("/goals"));
  }, [router, link]);
  return null;
}
