/** Email footer "Manage emails" landing → the user's notification settings. */

import { EmailLinkRedirect } from "@/features/notifications";

export const dynamic = "force-dynamic";

export default function EmailSettingsPage() {
  return <EmailLinkRedirect settings />;
}
