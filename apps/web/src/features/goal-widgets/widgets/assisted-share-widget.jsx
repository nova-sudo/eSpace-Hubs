"use client";

import { LabelShareWidget } from "./label-share-widget";

/**
 * Assisted share — merged pull requests carrying an assistant label.
 *
 * The assistant preset of `LabelShareWidget`: same window, same repo scope,
 * same floor caveat, with the assistant labels (claude-code-assisted and
 * friends) watched when the spec names none of its own. Kept as its own
 * SPEC_KIND so the classifier can pick "AI adoption" by name and older specs
 * keep rendering unchanged.
 */
export function AssistedShareWidget(props) {
  return <LabelShareWidget {...props} assisted />;
}
