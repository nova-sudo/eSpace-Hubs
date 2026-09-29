"use client";

/**
 * Draft flushing for editors that hold a local draft (free-text note,
 * before/after pair) instead of writing on every keystroke.
 *
 * The cadence stepper's panel has ONE affirmative button ("Save" / "Save &
 * grade") and one exit ("Back to Wk N"). Before this, neither knew about the
 * editor's draft: Save closed the panel with the note unsaved, and Back
 * dropped it silently. An editor registers its draft here; the host flushes
 * every dirty draft on Save and asks before discarding them on Back.
 *
 *   // host
 *   const drafts = useDraftRegistry();
 *   <DraftFlushProvider registry={drafts}> …editors… </DraftFlushProvider>
 *   const { ok, failed } = drafts.flushAll();   // on Save — keep the panel
 *   if (!ok) failed[0].focus?.();                // open when a draft didn't save
 *   drafts.anyDirty();                           // before Back
 *
 *   // editor — `flush` returns `{ ok }` (false / { ok: false } = not saved)
 *   const hosted = useDraftFlush({ dirty, flush, focus });
 *   // `hosted` is true under a provider — the editor can hide its own
 *   // Save button then, since the host's button now does that job.
 */

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import { createDraftRegistry } from "./draft-registry.js";

const DraftFlushContext = createContext(null);

export function useDraftRegistry() {
  const ref = useRef(null);
  if (!ref.current) ref.current = createDraftRegistry();
  return ref.current;
}

/**
 * `hosting` (default true): this host has its own Save, so editors under it
 * hide theirs. A dialog that only GUARDS its exit (the fill modal: confirm
 * before Esc / ✕ drops a draft) passes `hosting={false}` — the editors keep
 * their own Log/Save buttons.
 *
 * Providers nest: an editor registers with EVERY host above it, so an outer
 * guard still sees a draft that lives inside an inner host (the cadence
 * stepper's panel inside the fill modal).
 */
export function DraftFlushProvider({ registry, hosting = true, children }) {
  const parent = useContext(DraftFlushContext);
  const chain = useMemo(
    () => [{ registry, hosting }, ...(parent ?? [])],
    [registry, hosting, parent],
  );
  return <DraftFlushContext.Provider value={chain}>{children}</DraftFlushContext.Provider>;
}

/**
 * Register a draft with the enclosing hosts. Returns true when a HOSTING
 * provider exists (the editor can hide its own Save). The registered entry
 * reads through a ref refreshed after every commit, so a host always sees
 * the latest `dirty`, `flush` and `focus`.
 */
export function useDraftFlush({ dirty, flush, focus }) {
  const chain = useContext(DraftFlushContext);
  const id = useId();
  const latest = useRef({ dirty, flush, focus });
  // Refreshed in a layout effect rather than during render — the host only
  // reads it from event handlers, which always run after a commit.
  useLayoutEffect(() => {
    latest.current = { dirty, flush, focus };
  });
  useEffect(() => {
    if (!chain || chain.length === 0) return undefined;
    const entry = {
      get dirty() {
        return latest.current.dirty;
      },
      flush: () => latest.current.flush?.(),
      focus: () => latest.current.focus?.(),
    };
    for (const { registry } of chain) registry.register(id, entry);
    return () => {
      for (const { registry } of chain) registry.unregister(id);
    };
  }, [chain, id]);
  return Array.isArray(chain) && chain.some((c) => c.hosting);
}
