/**
 * Barrel + factory for the default classifier.
 *
 * The classifier itself is OpenAI-compatible (Mistral and GLM/Z.ai both
 * speak that protocol). Provider selection — including which env vars
 * to read — lives in `../provider.ts`. This file just plugs the
 * resolved provider into the streaming classifier factory.
 *
 * Swapping providers (Anthropic, OpenAI, local) is a one-line change:
 * import a different adapter factory. Every consumer reads only the
 * AnalysisEvent stream, so nothing downstream changes.
 *
 * Ported from apps/web/src/features/analyst/ai/classifier-index.js (M3.2).
 */

import type { Request } from "express";
import { resolveRequestedId, selectProvider } from "../provider.js";
import { createAnthropicClassifier, isAnthropicId } from "../anthropic.js";
import {
  createMistralClassifier,
  type ClassifierPort,
} from "./mistral-classifier.js";

export {
  ANALYSIS,
  ALL_ANALYSIS_EVENTS,
  AnalysisEvents,
  type AnalysisEvent,
} from "./events.js";
export { createMistralClassifier };
export type {
  ClassifierPort,
  ClassifyOptions,
  ClassifierConfig,
  GoalForClassification,
} from "./mistral-classifier.js";

interface CreateDefaultOpts {
  request?: Request;
  bodyProvider?: string | null;
}

/**
 * Build the default classifier from env + the supplied request (which
 * carries the `x-ai-provider` header / body field).
 *
 * Throws when the chosen provider has no API key — the caller catches
 * and surfaces 500 with the missing env-var name.
 */
export function createDefaultClassifier(
  opts: CreateDefaultOpts = {},
): ClassifierPort {
  const selectInput = {
    ...(opts.request ? { request: opts.request } : {}),
    bodyProvider: opts.bodyProvider ?? null,
  };

  const concurrencyEnv = Number(
    process.env.GOAL_CLASSIFIER_CONCURRENCY,
  );
  const concurrency =
    Number.isFinite(concurrencyEnv) && concurrencyEnv > 0
      ? concurrencyEnv
      : 3;

  // Claude uses its own SDK path, not the OpenAI-compatible classifier.
  // getClient() inside throws the missing-key HttpError, which the
  // controller catches and surfaces as a 500 just like the OpenAI branch.
  if (isAnthropicId(resolveRequestedId(selectInput))) {
    return createAnthropicClassifier(concurrency);
  }

  const provider = selectProvider(selectInput);
  if (!provider.apiKey) {
    throw new Error(
      `${provider.label} has no API key. Set ${provider.keyEnv} in apps/api/.env.local and restart.`,
    );
  }
  return createMistralClassifier({
    apiKey: provider.apiKey,
    url: provider.url,
    model: provider.model,
    label: provider.label,
    extraHeaders: provider.extraHeaders,
    concurrency,
  });
}
