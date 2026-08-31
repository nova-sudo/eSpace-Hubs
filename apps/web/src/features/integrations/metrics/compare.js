/**
 * Period-over-period comparison helpers.
 *
 * Convention: positive `delta` = "more in the current period". Callers decide
 * whether that's good or bad (see `invert` in <Delta>).
 */

export function compareCount(current, previous) {
  // `??` doesn't catch NaN: `Number(undefined) ?? 0` is NaN, so an
  // absent input (source still loading / errored) rendered a literal
  // "NaN" delta chip. Coerce through a finite check instead.
  const toCount = (v) => {
    if (Array.isArray(v)) return v.length;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const c = toCount(current);
  const p = toCount(previous);
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
