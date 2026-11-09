import { redirect } from "next/navigation";

/**
 * /waiting-approval — retired with account approval (2026-11). Old
 * links and bookmarks land on the "check your inbox" screen, which
 * forwards verified users on.
 */
export default function WaitingApprovalPage() {
  redirect("/verify-email-pending");
}
