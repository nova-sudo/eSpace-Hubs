/**
 * The four HTML templates a review packet can render as. Ids match the
 * API's `PacketTemplate` enum (`review-packets/packet-body.ts`).
 */
export const PACKET_TEMPLATES = Object.freeze([
  Object.freeze({ id: "scorecard", label: "Scorecard", blurb: "Every goal on one page, tier and reading side by side." }),
  Object.freeze({ id: "journey", label: "Journey", blurb: "The cycle window by window, showing how each goal moved." }),
  Object.freeze({ id: "deck", label: "Deck", blurb: "One goal per slide, for walking through in a review meeting." }),
  Object.freeze({ id: "dossier", label: "Dossier", blurb: "The full record: ladders, reasoning and every piece of proof." }),
]);

export const TEMPLATE_IDS = Object.freeze(PACKET_TEMPLATES.map((t) => t.id));
