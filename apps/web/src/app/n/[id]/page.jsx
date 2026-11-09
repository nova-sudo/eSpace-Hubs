/** Email button landing — see features/notifications/email-link-redirect. */

import { EmailLinkRedirect } from "@/features/notifications";

export const dynamic = "force-dynamic";

export default async function NotificationLinkPage({ params }) {
  const { id } = await params;
  return <EmailLinkRedirect id={id} />;
}
