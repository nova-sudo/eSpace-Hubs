import { DAY_MS } from "@/lib/date";

/**
 * Bucketize raw GitLab events into one count per day, oldest → newest.
 */
export function dailyActivity(events = [], days = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    buckets.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      n: 0,
    });
  }
  const byDate = Object.fromEntries(buckets.map((b) => [b.date, b]));
  for (const ev of events) {
    const d = (ev.created_at || "").slice(0, 10);
    if (byDate[d]) byDate[d].n += 1;
  }
  return buckets;
}

export function totalEvents(buckets = []) {
  return buckets.reduce((s, b) => s + b.n, 0);
}

export function peakPerDay(buckets = []) {
  return buckets.reduce((m, b) => Math.max(m, b.n), 0);
}
