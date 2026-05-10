import { DAY_MS } from "@/lib/date";

/** Median open → merged duration, in days. */
export function medianTurnaroundDays(mrs = []) {
  const durations = mrs
    .filter((m) => m.merged_at && m.created_at)
    .map((m) => (new Date(m.merged_at) - new Date(m.created_at)) / DAY_MS)
    .sort((a, b) => a - b);
  if (durations.length === 0) return null;
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
}

/** Mean open → merged duration, in days. */
export function meanTurnaroundDays(mrs = []) {
  const durations = mrs
    .filter((m) => m.merged_at && m.created_at)
    .map((m) => (new Date(m.merged_at) - new Date(m.created_at)) / DAY_MS);
  if (durations.length === 0) return null;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

/**
 * Bucketize turnaround into the 6 display bins the HexaCore histogram uses.
 * Units: hours.
 */
const BINS = [
  { label: "<2h", max: 2 },
  { label: "2–8h", max: 8 },
  { label: "8–24h", max: 24 },
  { label: "1–2d", max: 48 },
  { label: "2–4d", max: 96 },
  { label: ">4d", max: Infinity },
];

export function turnaroundHistogram(mrs = []) {
  const bins = BINS.map((b) => ({ ...b, n: 0 }));
  for (const m of mrs) {
    if (!m.merged_at || !m.created_at) continue;
    const hours = (new Date(m.merged_at) - new Date(m.created_at)) / 3_600_000;
    const bucket = bins.find((b) => hours < b.max);
    if (bucket) bucket.n += 1;
  }
  return bins;
}

export function fmtDurationHours(days) {
  if (days == null) return "—";
  const h = days * 24;
  if (h < 24) return `${Math.round(h)}h`;
  return `${days.toFixed(1)}d`;
}
