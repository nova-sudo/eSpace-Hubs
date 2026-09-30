/**
 * Pure request coalescer for evidence manifests — see `use-evidence-manifest.js`.
 * No React / network imports so it is unit-testable.
 */

/** Goal ids per batched request — mirrors the server's cap. */
export const MANIFEST_BATCH_MAX = 50;

/**
 * Coalesce every manifest request made in the same tick into ONE
 * `GET /goal-evidence/manifests?goalIds=…`. Timeline and the Evidence
 * board mount a tier badge per goal, and each used to GET its own list —
 * 13 requests for 13 goals. `fetchOne(goalId)` keeps the per-goal SWR key
 * (so an upload's `mutate(["goal-evidence-manifest", id])` still works)
 * while the wire sees one request. `request(ids)` resolves to
 * `{ [goalId]: files[] }`; when it fails (e.g. an older API without the
 * batch route) each goal falls back to its own `fallback(goalId)` GET.
 */
export function createManifestBatcher({ request, fallback, schedule = (fn) => setTimeout(fn, 0) }) {
  let pending = new Map();
  let scheduled = false;
  const flush = async () => {
    scheduled = false;
    const batch = pending;
    pending = new Map();
    const ids = [...batch.keys()];
    for (let i = 0; i < ids.length; i += MANIFEST_BATCH_MAX) {
      const chunk = ids.slice(i, i + MANIFEST_BATCH_MAX);
      let manifests = null;
      try {
        manifests = await request(chunk);
      } catch {
        manifests = null;
      }
      for (const id of chunk) {
        const waiters = batch.get(id);
        if (manifests && Array.isArray(manifests[id])) {
          for (const w of waiters) w.resolve(manifests[id]);
        } else if (manifests) {
          for (const w of waiters) w.resolve([]);
        } else {
          Promise.resolve()
            .then(() => fallback(id))
            .then(
              (files) => waiters.forEach((w) => w.resolve(files)),
              (err) => waiters.forEach((w) => w.reject(err)),
            );
        }
      }
    }
  };
  return function fetchOne(goalId) {
    return new Promise((resolve, reject) => {
      if (!pending.has(goalId)) pending.set(goalId, []);
      pending.get(goalId).push({ resolve, reject });
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    });
  };
}

