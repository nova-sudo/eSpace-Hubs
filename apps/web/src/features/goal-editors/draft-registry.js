/**
 * The framework-free half of draft flushing (see draft-flush-context.jsx).
 *
 * An entry is `{ dirty, flush, focus? }`. `flush()` reports whether the
 * draft actually saved: `false` or `{ ok: false }` means it did NOT (a
 * validation error, a rejected append) — the draft is still there and the
 * host must not close over it. Anything else counts as saved, so an editor
 * that returns nothing keeps working.
 */

/** True when a flush result says the draft did not save. */
export function flushFailed(result) {
  return result === false || (result != null && typeof result === "object" && result.ok === false);
}

export function createDraftRegistry() {
  const map = new Map();
  return {
    map,
    register(id, entry) {
      map.set(id, entry);
    },
    unregister(id) {
      map.delete(id);
    },
    anyDirty() {
      for (const d of map.values()) if (d.dirty) return true;
      return false;
    },
    /**
     * Flush every dirty draft (in registration order). Every dirty draft is
     * attempted even after one fails, so a valid note still saves next to an
     * invalid pair. `{ ok: false, failed }` lists the entries that did not
     * save, first one first — the host focuses `failed[0]`.
     */
    flushAll() {
      const failed = [];
      for (const d of map.values()) {
        if (!d.dirty) continue;
        let res;
        try {
          res = d.flush?.();
        } catch {
          res = false;
        }
        if (flushFailed(res)) failed.push(d);
      }
      return { ok: failed.length === 0, failed };
    },
  };
}
