/**
 * goal-editors — shared domain owning the per-widget INPUT editors.
 *
 * These were born inside the weekly check-in, but the Goal Intelligence
 * Hub now fills goals inline too, so the editors live here as a shared
 * domain both product surfaces consume (web → shared, never product →
 * product). The check-in page composes them with its own row chrome +
 * auto-readouts; the hub renders one via `GoalManualEditor`.
 */

export {
  AutoReadout,
  BeforeAfterEditor,
  CounterEditor,
  DateLogEditor,
  FreeTextEditor,
  IncidentLogEditor,
  MilestoneEditor,
  RecurringMilestoneEditor,
  ScaleEditor,
  UnsupportedStub,
} from "./editors";
export {
  GoalManualEditor,
  isInlineFillable,
  INLINE_FILLABLE_KINDS,
} from "./dispatch";
