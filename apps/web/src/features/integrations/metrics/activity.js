import { DAY_MS } from "@/lib/date";

/**
 * YYYY-MM-DD in **local** time.
 *
 * Why this exists: the obvious shortcut `date.toISOString().slice(0, 10)`
 * formats in UTC, not the user's local zone. Mixing that with bucket
 * boundaries anchored at local midnight (via `setHours(0, 0, 0, 0)`)
 * produces a one-day mismatch for every user east of UTC.
 *
 * Concretely (Cairo, UTC+2):
 *   - local midnight today = 2026-05-11 00:00 local = 2026-05-10 22:00Z
 *   - `today.toISOString().slice(0,10)` = "2026-05-10"  ← yesterday UTC!
 *   - an event at 17:37Z today has slice = "2026-05-11"
 *   - the buckets {…, "2026-05-09", "2026-05-10"} never contain
 *     "2026-05-11", so today's events fall outside every bucket
 *     and `totalEvents` returns 0
 *
 * Using local-time components from `getFullYear/getMonth/getDate` for
 * BOTH the bucket key AND the event-lookup key keeps everything in the
 * same reference frame.
 */
function localDateKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Bucketize raw events into one count per local-time day, oldest → newest.
 */
export function dailyActivity(events = [], days = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    buckets.push({
      date: localDateKey(d),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      n: 0,
    });
  }
  const byDate = Object.fromEntries(buckets.map((b) => [b.date, b]));
  for (const ev of events) {
    if (!ev?.created_at) continue;
    const key = localDateKey(ev.created_at);
    if (byDate[key]) byDate[key].n += 1;
  }
  return buckets;
}

export function totalEvents(buckets = []) {
  return buckets.reduce((s, b) => s + b.n, 0);
}

export function peakPerDay(buckets = []) {
  return buckets.reduce((m, b) => Math.max(m, b.n), 0);
}
