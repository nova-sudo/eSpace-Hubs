/**
 * Analyst feature — public API.
 *
 * Post-M7.9c: the classifier itself runs server-side on the API at
 * /api/v1/ai/classify-goals; the local classifier factory used to live
 * here but moved to apps/api/src/modules/ai/classifier. This barrel
 * now exports only the UI surfaces and the streaming consumer hook.
 *
 * The `ANALYSIS` enum + `analysis-events` module stay because the
 * NDJSON stream consumer (use-classify-goals.js) and the renderer
 * (analysis-stream.jsx) need them — both import from `./ai/analysis-
 * events` directly.
 */
export { AnalystProvider, useAnalyst, ANALYST_MODES } from "./analyst-provider";
export { AnalystPage } from "./analyst-page";
export { AnalystActivator } from "./analyst-activator";
export { AnalysisStream } from "./analysis-stream";
export {
  useClassifyGoals,
  CLASSIFY_PHASES,
  flattenGoalsForClassification,
} from "./use-classify-goals";
export { reclassifyOneGoal } from "./reclassify-one-goal";
export { AI_PROVIDERS, setAiProvider, useAiProvider, getAiProvider } from "./use-ai-provider";
