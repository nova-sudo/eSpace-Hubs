/**
 * Shared (assigned) goals — a manager authors one goal, assigns it to
 * people who fill it inside their own goal tree, and shares its analytics
 * with viewers. Shared domain: consumed by the manager hub page and the
 * "Shared with me" page.
 */

export {
  archiveAssignedGoal,
  createAssignedGoal,
  updateAssignedGoal,
  useAssignedProgress,
  useCreatedAssignedGoals,
  useOrgPeople,
  useSharedWithMe,
  setAssignedVerdict,
} from "./api";
export { ArchivedSharedGoals } from "./archived-shared-goals";
export { AssignedGoalEditor } from "./assigned-goal-editor";
export { AssignedGoalProgress } from "./assigned-goal-progress";
export { SharedGoalsList } from "./shared-goals-list";
export { PeoplePicker } from "./people-picker";
export { SharedWithMePage } from "./shared-with-me-page";
