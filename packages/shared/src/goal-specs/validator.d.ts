/**
 * Type signatures for the validator. Runtime lives in validator.js.
 */

import type { ValidatedSpec, SpecKind, SpecVariant } from "./types.js";

export type ValidationResult =
  | { ok: true; spec: ValidatedSpec }
  | { ok: false; errors: string[] };

export function validateSpec(obj: unknown): ValidationResult;

export function isSpec(value: unknown): boolean;

export interface BuildSpecInput {
  goalId: string;
  title: string;
  kind: SpecVariant;
  widget: SpecKind;
  reasoning?: string;
  source?: unknown;
  manual?: unknown;
  context?: unknown;
  delegated?: unknown;
  untrackable?: unknown;
  scorecard?: unknown;
  /** Generative COMPOSED widget: field schema + cadence/prompt frame. */
  fields?: unknown;
  composed?: unknown;
  /** Achievement-tier criteria + numeric tier ladder. */
  tiers?: unknown;
  tierScale?: unknown;
  firstReviewOnly?: unknown;
  classifiedAt?: number;
}

export function buildSpec(input: BuildSpecInput): ValidationResult;
