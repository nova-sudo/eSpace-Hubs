/**
 * Pure helpers for notification preferences (notification-prefs.js).
 */

/** `muted` with every server-declared unmutable kind removed. */
export function withoutUnmutable(muted, unmutable = []) {
  return (muted || []).filter((k) => !unmutable.includes(k));
}

/** The muted list after muting (`mute`) or unmuting one kind. */
export function nextMuted(muted, kind, mute, unmutable = []) {
  const base = withoutUnmutable(muted, unmutable).filter((k) => k !== kind);
  if (mute && !unmutable.includes(kind)) base.push(kind);
  return base;
}
