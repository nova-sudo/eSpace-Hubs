/**
 * Notifications feature — in-app inbox. The bell mounts in the shell
 * header; the store hydrates from GET /api/v1/notifications.
 */

export { NotificationBell } from "./notification-bell.jsx";
export { useNotifications } from "./use-notifications";
export { fetchNotifications, resetNotifications } from "./notifications-store";
export { NotificationsPage } from "./notifications-page.jsx";
export { NotificationPreferences } from "./notification-preferences.jsx";
export { notificationPath, NOTIFICATION_KIND_GROUPS } from "./notification-kinds";
export { EmailLinkRedirect } from "./email-link-redirect.jsx";
export { resolveEmailTarget, EMAIL_SETTINGS } from "./email-target.js";
