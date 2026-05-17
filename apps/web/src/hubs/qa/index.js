/**
 * QA Hub public surface. The placeholder stays exported for hub
 * slots that don't yet have a real component (goals reuses the
 * shared goals page, but evidence + settings are still scaffolds).
 *
 * Real components landing across this arc:
 *   QaDashboard            — PR A (this PR): main /qa/dashboard
 *   BuildPassRateTile      — PR A: Jenkins-fed headline tile
 *   (more)                 — PR B (Zephyr), PR C (defect tags), PR D
 */

export { QaPlaceholder } from "./qa-placeholder.jsx";
export { QaDashboard } from "./qa-dashboard.jsx";
export { BuildPassRateTile } from "./build-pass-rate-tile.jsx";
export { FlakeRateTile } from "./flake-rate-tile.jsx";
export { DefectsTile } from "./defects-tile.jsx";
export { DefectPriorityMixTile } from "./defect-priority-mix-tile.jsx";
