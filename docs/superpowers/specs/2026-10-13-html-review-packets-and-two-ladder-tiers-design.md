# HTML review packets + two-ladder tiers for BYO goals

Date: 2026-10-13 · Status: approved in chat, pending implementation plan

## Why

1. Review packets are frozen as markdown on the Evidence page and shown to the
   manager as raw text in a `<pre>`. Nothing renders them. The stored row keeps
   only the markdown plus thin goal rows, so no template can be built from it.
2. A BYO (COMPOSED) goal stores one tier ladder, `spec.tiers`. The whole-cycle
   verdict and the per-window ("this week") verdict are both graded and
   explained against the same text. The compose prompt writes per-period
   wording, the classifier writes whole-cycle wording, so one of the two scopes
   always reads wrong (e.g. a weekly panel saying "all 24 weekly deliverables
   across the 6-month plan"). Managers see the ladder read-only in Approvals and
   cannot change it before approving.

## Scope

In: packet schema v2 + structured payload, one shared packet view with four
selectable templates (Scorecard, Cycle journey, Goal deck, Dossier), a
standalone packet page, two ladders per BYO spec (`tiers` whole-cycle,
`cadenceTiers` one window), scoped AI generation and grading, inline ladder
editing in manager + admin approval that persists on approve.

Out: PDF export of packets, changing manager verdict (grade) flows, tier
policies by Goal Code (unchanged), markdown-to-HTML rendering of old packets.

## 1. Packet data (apps/api)

`review_packets` schema v2. New fields:

- `version: 2` (v1 rows have no `version`).
- `template: "scorecard" | "journey" | "deck" | "dossier"`.
- `payload` (object, ≤ 400 KB):
  - `range: { label, start, end }`, `cycleKey`, `submitter: { displayName, level, department }`
  - `objectives[]`: `{ id, title, weight, reading?, goals[] }`
  - `goals[]` (under an objective): `{ id, title, kind, cadence?, target?,
    reading?, statusLabel?, statusReason?, tiers?, cadenceTiers?,
    verdict?: { tier, reasoning, lowConfidence, gradedAt }, managerVerdict?:
    { tier, note, gradedAt }, windows[]: { key, label, state, verdict? },
    evidence[]: { at, text, link? } }`
  - `untracked[]`: `{ id, title, l1Title }`
  - `totals: { goals, tracked, byTier: { notAchieved, achieved, overAchieved, roleModel } }`
- `markdown` and `narrative` become optional (v1 rows keep them; v2 rows omit
  narrative, may omit markdown). `starredCount` optional.

Submit route accepts v2 bodies (zod: `version: 2`, `template`, `payload`) and
keeps the 20-version prune, audit, and `review_packet_submitted` notification.

New read route `GET /api/v1/review-packets/:id` returns the full packet when the
session is the owner, the owner's current manager (`resolveReportFor`), or an
org admin (`users.manage`). Existing `/mine`, `/mine/:id` and the manager list
route keep working; the manager list returns `template` and `version` in meta.

`computeGoalHealth` reads the latest headline from `payload.objectives[].goals[].reading`
for v2 rows and from `goals[].reading` for v1.

## 2. Packet rendering (apps/web)

New shared domain `features/review-packet/` (barrel-only imports):

- `build-packet-payload.js` — pure: `(docProps, goalReadings, goals, specs,
  windows, verdicts) → payload`. Same inputs the markdown renderer uses today.
- `use-review-packet.js` — SWR hook for `GET /review-packets/:id`.
- `packet-view.jsx` — picks the template component by `packet.template`; v1
  packets render `packet-legacy.jsx` (the current `<pre>` + download).
- `templates/scorecard.jsx` — one page; counters tick up, tier chips pop in,
  weight ring per objective, goals grouped under objectives.
- `templates/journey.jsx` — horizontal window strip across the top; scroll
  drives reveal; each goal row fills window by window, misses are gaps.
- `templates/deck.jsx` — full-screen card per goal, cover + closing summary
  card, arrow keys / swipe, progress dots.
- `templates/dossier.jsx` — paper-like report, staggered section reveal, tier
  "seal" stamps onto each goal, clean `@media print`.
- `template-picker.jsx` — four thumbnails with a live preview of the current
  (unfrozen) payload.

All templates: Framer Motion, `prefers-reduced-motion` disables motion, tokens
only (Manrope, ink + tints, no hex), work at phone width.

Mount points:

- New route `app/[hub]/packets/[id]/page.jsx` → `PacketPage` (header: name,
  range, template, "Download .md" when markdown exists, "Copy link").
- Evidence page: submit card gains the template picker; "Last submitted packet"
  viewer renders `PacketView` instead of `<pre>`.
- Manager `ReviewPacketCard` becomes a preview (totals + byTier strip) with
  "Open packet" → the packets route. The board header button opens it too.
- Admin: no viewer page; the packets route already admits admins.

Removed from packets: the narrative ("01 · Summary") and "03 · Starred proof"
sections. The evidence board's starred items and narrative stay as page
features and as inputs to the markdown/PDF export, which remain available on
the Evidence page as side exports.

## 3. Two ladders per BYO goal (packages/shared + apps/api + apps/web)

- `ValidatedSpec.cadenceTiers?: SpecTiers | null` — "one window" ladder.
  `tiers` stays the whole-cycle ladder. Validator accepts both; `tiersLocked`
  covers both.
- Resolution helper in shared: `resolveLadders(spec, policy) →
  { final, cadence, cadenceFallback: boolean }`. `cadence` falls back to
  `tiers` when `cadenceTiers` is null; `cadenceFallback` tells the UI.
- AI compose (`ai/controller.ts` compose-widget prompt): request
  `tiers` (whole cycle, may reference the full plan) and `cadenceTiers` (one
  window only, must not reference totals across windows). `cleanTiers` runs
  on both. `findUngradeableTiers` checks each ladder against its own scope:
  whole-cycle wording in `cadenceTiers`, or single-window wording in `tiers`,
  is flagged and the handler asks the model once to fix it.
- Classifier (RECURRING_MILESTONE streak ladder): streak ladder → `tiers`;
  derive `cadenceTiers` from the period rule ("logged complete this period"
  etc.).
- Grading: `gradeGoalTierSchema` gains `scope: "goal" | "window"` (default
  `goal` for compatibility). The system prompt applies the mid-cycle pacing
  rule only for `goal`; for `window` it grades the window's data against the
  window ladder only.
- Web: `useGoalWindowTier` uses `resolveLadders(...).cadence` and passes
  `scope: "window"`. `useGoalTier` uses `.final`. `readCappedGoalTier` and
  manager `goal-detail.ts` project both ladders. `WindowTierPanel` renders
  whenever a cadence ladder resolves (not only when `spec.tiers` exists) and
  shows "Same ladder as the whole goal — re-run compose to split" when
  `cadenceFallback`. `TierEditor` edits both ladders under two labels.
- Tier hash includes both ladders so cached verdicts invalidate correctly.

## 4. Manager + admin approval

- `listApprovalsHandler` returns `tiers`, `cadenceTiers`, and `tiersSource:
  "ai" | "user"` per item.
- Approval item UI (`manager-approvals.jsx`, `admin-approvals.jsx`): the
  "Achievement levels" block moves to the top, two labelled ladders ("Whole
  cycle", "Each <cadence>"), each of the four rows an inline textarea prefilled
  from the AI with a "Suggested by AI" badge that clears on edit, a "Reset to
  AI" link. Approve button copy: "Approve with these levels".
- `putApprovalDecisionHandler` accepts optional `tiers` and `cadenceTiers` on
  `approve`; validates with the shared validator; writes them to the spec with
  `tiersLocked: true`, bumps the spec `updatedAt`, audits
  `goal_spec.approve` with `{ tiersChanged, cadenceTiersChanged }`, and the
  existing approval notification to the dev mentions when levels were edited.
  `request_changes` unchanged.

## 5. Migration and compatibility

- Specs without `cadenceTiers`: windows fall back to `tiers` with the UI flag.
  No data migration.
- v1 packets render through `packet-legacy.jsx`. No backfill.
- `wipe-user-data.mjs` already covers `review_packets`.

## 6. Testing

- api: packet v2 zod + Mongo validator round-trip; `/review-packets/:id` access
  (owner, current manager, admin, stranger 404); approval approve writes
  ladders + `tiersLocked` and audits; compose returns two ladders and the
  scope check flags cross-scope wording; grade schema accepts `scope`.
- shared: validator accepts/rejects `cadenceTiers`; `resolveLadders` fallback.
- web: `build-packet-payload` snapshot from fixture readings; `PacketView`
  template switch + legacy path; approval editor state ("Suggested by AI"
  clears, reset works, approve payload carries edited ladders);
  architecture-boundaries passes with the new feature; design-system guard
  passes.
