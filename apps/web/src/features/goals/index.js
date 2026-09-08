export { useGoals } from "./use-goals";
export { GoalsEditor } from "./goals-editor";
export { GoalsImport } from "./goals-import";
export {
  addL1,
  addL2,
  appendGoals,
  removeL1,
  removeL2,
  updateL1,
  updateL2,
  readGoals,
  replaceGoals,
  clearGoals,
  loadTestGoals,
  fetchGoals,
  resetGoals,
  GOAL_PRIORITIES,
  GOAL_CATEGORIES,
  GOALS_SCHEMA_VERSION,
} from "./goals-store";
export { parseImportFile, mergeImport } from "./import-parser";

// Pre-cutover Goals page (tree tile + evidence strip + widget grid).
// `/[hub]/goals` renders the flow map (`features/goals-flow`) now; this stays
// exported so the route swap is reversible in one line.
export { GoalsPage } from "./goals-page/goals-page";
