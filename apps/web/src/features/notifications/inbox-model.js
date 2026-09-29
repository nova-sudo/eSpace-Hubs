/**
 * Pure state transitions for the notification inbox (use-notification-inbox).
 * Kept out of the hook so the "should this POST?" decision is made from a
 * plain value, never from a side effect inside a React state updater.
 */

/**
 * The inbox state after marking `id` read, or null when nothing changes (no
 * such row, or it is already read) — null means "don't POST".
 */
export function applyMarkRead(state, id) {
  const items = state?.items || [];
  if (!items.some((n) => n.id === id && !n.read)) return null;
  return {
    ...state,
    items: items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    unread: Math.max(0, (state.unread || 0) - 1),
  };
}
