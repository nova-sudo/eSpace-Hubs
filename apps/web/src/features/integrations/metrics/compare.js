/**
 * Period-over-period comparison helpers.
 *
 * Convention: positive `delta` = "more in the current period". Callers decide
 * whether that's good or bad (see `invert` in <Delta>).
 */

export function compareCount(current, previous) {
  const c = current?.length ?? Number(current) ?? 0;
  const p = previous?.length ?? Number(previous) ?? 0;
  return { current: c, previous: p, delta: c - p };
}

export function compareNumber(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  const safe = (n) => (Number.isFinite(n) ? n : null);
  const cur = safe(c);
  const prv = safe(p);
  if (cur == null || prv == null) {
    return { current: cur, previous: prv, delta: null };
  }
  return {
    current: cur,
    previous: prv,
    delta: Math.round((cur - prv) * 100) / 100,
  };
}
