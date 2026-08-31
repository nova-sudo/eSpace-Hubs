"use client";

import { toast } from "sonner";
import { setLock } from "@/features/goal-locks";

/**
 * Settle ("skip") a goal's current window — with acknowledgement and a
 * way back. The raw `setLock(...)` call used to fire silently: the card
 * vanished from the attention queue with no toast and no undo, and the
 * only reopen control lived on the full board, which is collapsed by
 * default — a misclick meant a silently settled period. Shared by the
 * Focus hero and the health card so both paths behave identically.
 */
export function skipWindow(goal, windowKey) {
  if (!goal?.id || !windowKey) return;
  setLock(goal.id, windowKey, true);
  const title = goal.title?.trim() || "Goal";
  toast(`"${title}" settled for this period`, {
    description: "It won't ask again until the next window.",
    action: {
      label: "Undo",
      onClick: () => setLock(goal.id, windowKey, false),
    },
  });
}
