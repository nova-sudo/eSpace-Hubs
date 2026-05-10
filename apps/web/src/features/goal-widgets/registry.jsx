"use client";

/**
 * Widget registry — a single source of truth mapping SPEC_KINDS → React
 * components.
 *
 * Open/Closed: adding a new widget means
 *   1. Write the component file.
 *   2. Add one `registerWidget(SPEC_KINDS.FOO, {...})` line to `_register.jsx`.
 * Nothing else needs to change. No switch statements to hunt down, no
 * `GoalWidget` to extend, no hook to branch on kind.
 *
 * The registry is lazily populated by `_register.jsx`, which is imported
 * once from the feature's barrel (`index.js`). Registering at module load
 * means the first consumer that renders a <GoalWidget> sees every widget
 * present, strictly-mode-safe (registration is idempotent by kind).
 */

import { SPEC_KINDS, SPEC_KIND_META } from "@/features/goal-specs";

/** @type {Map<string, WidgetDef>} */
const registry = new Map();

/**
 * Shape of each entry.
 *   kind        : one of SPEC_KINDS
 *   Component   : React component, receives { spec, goal, variant, className }
 *   variant     : "auto" | "manual" | "hybrid"  (for filtering / UI labeling)
 *   label?      : override for the "Classified as …" chip
 *   description?: one-line dev-facing doc, unused at runtime
 */
export function registerWidget(kind, def) {
  if (!kind || typeof kind !== "string") {
    throw new Error("registerWidget: `kind` is required");
  }
  if (!def?.Component) {
    throw new Error(`registerWidget(${kind}): Component is required`);
  }
  registry.set(kind, {
    kind,
    variant: def.variant || SPEC_KIND_META[kind]?.variant || "manual",
    label: def.label || SPEC_KIND_META[kind]?.label || kind,
    Component: def.Component,
    description: def.description,
  });
}

/** Resolve a spec to a WidgetDef (or null if none registered). */
export function resolveWidget(spec) {
  if (!spec?.widget) return null;
  return registry.get(spec.widget) || null;
}

/** Introspect — used by the analyst UI to surface "known widgets" chips. */
export function listWidgets() {
  return [...registry.values()];
}

/** Dev-time sanity check: is every SPEC_KIND covered by the registry? */
export function missingWidgetKinds() {
  return Object.values(SPEC_KINDS).filter((k) => !registry.has(k));
}
