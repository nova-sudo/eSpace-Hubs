/**
 * Notifications feature — in-app inbox. The bell mounts in the shell
 * header; the store hydrates from GET /api/v1/notifications.
 */

export { NotificationBell } from "./notification-bell.jsx";
export { useNotifications } from "./use-notifications";
export { fetchNotifications, resetNotifications } from "./notifications-store";
