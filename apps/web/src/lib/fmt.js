/**
 * Formatting helpers — number / duration / percent / date.
 * Pure, framework-agnostic. No React imports here.
 */

export function fmtNumber(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

export function fmtDays(days) {
  if (days == null || Number.isNaN(days)) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

export function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n)}%`;
}

export function fmtDelta(n, { digits = 0 } = {}) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

export function fmtRelative(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const hr = diff / 3_600_000;
  if (hr < 1) return `${Math.round(diff / 60_000)}m`;
  if (hr < 24) return `${Math.round(hr)}h`;
  return `${Math.round(hr / 24)}d`;
}
