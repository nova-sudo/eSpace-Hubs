"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Shared scroll-section state. Sections register themselves with an id + DOM
 * node; the `<ScrollShell>` owns the IntersectionObserver and sets `active`.
 * `<SectionRail>` and `<SectionCounter>` subscribe read-only.
 *
 * Why a context (and not a prop-drilled ref)?
 *   - The rail and the counter sit at the shell layer but need to know
 *     the active section id picked by children further down the tree.
 *   - Each `<Section>` calls `register(id, node)` from an effect so the IO
 *     can observe it; `register` returns an unregister for strict-mode
 *     double-mount cleanup.
 */
const ScrollContext = createContext(null);

export function ScrollProvider({ children }) {
  const scrollRootRef = useRef(null);
  const [sections, setSections] = useState([]); // [{id, node, label, num}]
  const [active, setActive] = useState(null);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const register = useCallback((meta) => {
    setSections((prev) => {
      const next = prev.filter((s) => s.id !== meta.id);
      next.push(meta);
      // Sort by DOM order so the rail and counter render top-to-bottom
      // regardless of registration order. `compareDocumentPosition` is
      // guarded because a section's node may be null mid-strict-mode.
      next.sort((a, b) => {
        if (!a.node || !b.node) return 0;
        const mask = a.node.compareDocumentPosition(b.node);
        if (mask & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (mask & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      return next;
    });
    return () => {
      setSections((prev) => prev.filter((s) => s.id !== meta.id));
    };
  }, []);

  // IntersectionObserver — runs at the scroll-root level, picks the
  // highest-ratio entry as active. Threshold array lets us get updates at
  // multiple visibility levels without constantly firing.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || sections.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        let bestId = null;
        let bestRatio = 0;
        // First: process incoming entries.
        entries.forEach((entry) => {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestId = entry.target.dataset.sectionId;
          }
        });
        if (bestId) setActive(bestId);
      },
      { root, threshold: [0.25, 0.5, 0.75] },
    );

    sections.forEach((s) => {
      if (s.node) io.observe(s.node);
    });

    return () => io.disconnect();
  }, [sections]);

  // Seed active to the first registered section so the rail/counter aren't
  // empty on initial paint before IO fires.
  useEffect(() => {
    if (!active && sections[0]) setActive(sections[0].id);
  }, [sections, active]);

  const scrollTo = useCallback((id) => {
    const target = sectionsRef.current.find((s) => s.id === id);
    if (target?.node) {
      target.node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const value = useMemo(
    () => ({ scrollRootRef, sections, active, setActive, register, scrollTo }),
    [sections, active, register, scrollTo],
  );

  return (
    <ScrollContext.Provider value={value}>{children}</ScrollContext.Provider>
  );
}

export function useActiveSection() {
  const ctx = useContext(ScrollContext);
  if (!ctx) {
    throw new Error(
      "useActiveSection must be used inside <ScrollProvider> / <ScrollShell>",
    );
  }
  return ctx;
}
