export { validateInput } from "./schema";
export {
  appendEntry,
  clearGoalEntries,
  getInputsState,
  INPUTS_CHANGE_EVENT,
  INPUTS_STORAGE_KEY,
  readGoalEntries,
  readInputs,
  removeEntry,
  replaceGoalEntries,
} from "./inputs-store";
export { useGoalInputs, useAllGoalInputs } from "./use-goal-inputs";
export { computeCompliance, cadenceWindowLabel } from "./compliance";
export { buildCycleWindows, currentPeriodKey, cadenceConsistency } from "./cadence-windows";
