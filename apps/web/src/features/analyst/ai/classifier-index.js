/**
 * Barrel + factory for the default server-side classifier.
 *
 * The classifier itself is OpenAI-compatible (Mistral and GLM/Z.ai both
 * speak that protocol). Provider selection — including which env vars
 * to read — lives in `@/lib/ai-providers`. This file just plugs the
 * resolved provider into the streaming classifier factory.
 *
 * Swapping providers (Anthropic, OpenAI, local) is still a one-line
 * change here: import a different adapter factory. Every consumer reads
 * only the AnalysisEvent stream, so nothing downstream needs to change.
 */

import { selectProvider } from "@/lib/ai-providers";
import { createMistralClassifier } from "./mistral-classifier";

export { ANALYSIS, AnalysisEvents, ALL_ANALYSIS_EVENTS } from "./analysis-events";
export { isClassifierPort } from "./classifier-port";
export { createMistralClassifier };

/**
 * Build the default classifier from env + the supplied request (which
 * carries the `x-ai-provider` header / body field).
 *
 * @param {{ request?: Request, bodyProvider?: string }} [opts]
 */
export function createDefaultClassifier(opts = {}) {
  const provider = selectProvider(opts);
  if (!provider.apiKey) {
    throw new Error(
      `${provider.label} has no API key. Set ${provider.keyEnv} in .env.local and restart the dev server.`,
    );
  }
  const concurrency = Number(process.env.GOAL_CLASSIFIER_CONCURRENCY) || 3;
  return createMistralClassifier({
    apiKey: provider.apiKey,
    url: provider.url,
    model: provider.model,
    label: provider.label,
    extraHeaders: provider.extraHeaders,
    concurrency,
  });
}
