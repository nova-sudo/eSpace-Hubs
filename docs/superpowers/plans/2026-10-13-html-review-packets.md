# HTML review packets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review packets freeze a structured, goals-only payload and render as one of four animated HTML templates that the dev, their manager, and admins all open from the same URL.

**Architecture:** The API stores packet v2 rows (`version`, `template`, `payload`) next to v1 rows and adds one access-resolved read route. A new web shared domain `features/review-packet` owns the payload builder, the fetch hook, a `PacketView` switch, and the four templates; the Evidence page, the manager board, and a new `/[hub]/packets/[id]` page mount it. Depends on the two-ladder plan only for `cadenceTiers` in the payload (optional field, safe to run first).

**Tech Stack:** apps/api (Express, zod, Mongo `$jsonSchema`, node:test), apps/web (Next 16 App Router, React, SWR, Framer Motion 12, Tailwind v4 tokens, node:test), packages/shared hub registry.

**Spec:** `docs/superpowers/specs/2026-10-13-html-review-packets-and-two-ladder-tiers-design.md` §1, §2, §5, §6.

## Global Constraints

- Templates: `"scorecard" | "journey" | "deck" | "dossier"`; payload ≤ 400,000 chars serialised; ≤ 500 goals; 20 versions per dev kept.
- v1 rows (no `version`) keep rendering through the legacy text view; nothing backfills.
- Design system v2: Manrope, tokens only (no hex, no dashed borders, no inline fontFamily), `Badge`/`Label`/`Card`/`Button` from `@/components/ui`, 16px side gutter at phone width, `prefers-reduced-motion` disables motion. `src/design-system-guard.test.js` must pass.
- Cross-feature imports barrel-only; `review-packet` is a shared domain (imports `goal-tiers`, `goal-specs`, `goal-inputs` barrels only; never `evidence`).
- Commit after each task; run the owning package's test script first.

## Review Focus

1. A v1 packet opened at `/[hub]/packets/[id]` must render its markdown, not crash on a missing `payload` (Task 4 test).
2. A manager whose report was reassigned away must get 404 on the packet, while the new manager gets 200 (Task 2 test).
3. A payload with zero tracked goals (all untracked) must render every template with an empty state, not NaN rings or division by zero (Task 3 totals test + each template's empty-state step).
4. Submitting while readings are pending must still be blocked, and the markdown side export must still work after narrative/starred leave the packet (Task 9).
5. A goal with no verdict (`verdict: null`) must render a neutral chip in every template (Task 5–8 steps).

---

### Task 1: Packet schema v2 (types, Mongo validator, zod)

**Files:**
- Modify: `apps/api/src/db/types.ts:545-581`
- Modify: `apps/api/src/db/schemas/review-packets.schema.ts`
- Create: `apps/api/src/modules/review-packets/packet-body.ts`
- Modify: `apps/api/src/modules/review-packets/controller.ts:28-44, 52-150`
- Test: `apps/api/src/modules/review-packets/packet-body.test.ts` (add to `apps/api/package.json` test list)

**Interfaces:**
- Produces types: `PacketTemplate = "scorecard" | "journey" | "deck" | "dossier"`; `ReviewPacketPayload` per spec §1 (`range`, `cycleKey`, `submitter`, `objectives[]` with nested `goals[]`, `untracked[]`, `totals`); `ReviewPacket` gains `version?: 1 | 2`, `template?: PacketTemplate`, `payload?: ReviewPacketPayload`, and `narrative`, `markdown`, `starredCount` become optional.
- Produces: `parsePacketBody(body: unknown): { version: 1, ...v1 } | { version: 2, template, payload, goals: ReviewPacketGoalRow[], goalCount, level, rangeLabel, markdown?: string }` — zod discriminated on `version` (missing → 1). For v2, `goals` is derived from `payload` (flatten objectives → `{ goalId, title, l1Title, tier, reading, statusLabel }`, plus `untracked` rows with `statusLabel: "No tracker yet"`), so v1 readers keep working. Throws `ZodError` on an oversize payload (serialised length > 400,000).
- Mongo validator: `required` drops `narrative`, `markdown`, `starredCount`; adds `version: { enum: [1, 2] }`, `template: { enum: [...] }`, `payload: { bsonType: "object" }` (shape enforced by zod, not Mongo).

- [ ] **Step 1: Failing tests**

```ts
test("v1 body parses as before", () => { assert.equal(parsePacketBody(V1).version, 1); });
test("v2 body derives flat goal rows from the payload", () => {
  const r = parsePacketBody(V2);
  assert.equal(r.version, 2);
  assert.deepEqual(r.goals[0], { goalId: "g1", title: "Ship X", l1Title: "Delivery", tier: "achieved", reading: "3 of 4", statusLabel: "on track" });
  assert.equal(r.goals.at(-1).statusLabel, "No tracker yet");
  assert.equal(r.goalCount, r.goals.length);
});
test("v2 rejects unknown template and oversize payload", () => { assert.throws(() => parsePacketBody({ ...V2, template: "pdf" })); });
```

- [ ] **Step 2: Run `cd apps/api && npx tsx --test src/modules/review-packets/packet-body.test.ts`** — FAIL.
- [ ] **Step 3: Implement** `packet-body.ts`, update types + validator, and make `submitReviewPacketHandler` build the doc from `parsePacketBody` (v2 doc: `version: 2, template, payload, goals, goalCount, level, rangeLabel, ...(markdown ? { markdown } : {}), starredCount: 0`). Audit `after.version`.
- [ ] **Step 4: Run `npm test`** — PASS. **Step 5: Commit** `feat(api): review packet schema v2`

---

### Task 2: Shared packet read route + v2-aware manager reads

**Files:**
- Create: `apps/api/src/modules/review-packets/packet-access.ts`
- Modify: `apps/api/src/modules/review-packets/controller.ts` (add `getReviewPacketHandler`), `routes.ts` (`GET /:id` after `/mine/:id`)
- Modify: `apps/api/src/modules/manager/controller.ts:346-354` (`latestReadingMap`), `:931-964` (meta adds `version`, `template`; index 0 adds `payload`)
- Test: `apps/api/src/modules/review-packets/packet-access.test.ts` (add to test list)

**Interfaces:**
- Produces: `packetAccess({ session: { userId, orgId, capabilities }, packet: { orgId, userId }, owner: { managerId, status } | null }): "owner" | "manager" | "admin" | null` — owner when `packet.userId.equals(session.userId)`; manager when `owner.managerId?.equals(session.userId)` and `owner.status !== "disabled"`; admin when `session` has `CAPABILITIES.ADMIN_USERS_MANAGE`; org mismatch → null.
- Produces: `latestReadingMap(packet): Map<goalId, reading>` — from `payload.objectives[].goals[]` for v2, `goals[]` for v1.
- `GET /api/v1/review-packets/:id` → `{ packet: { id, version, template, submittedAt, level, rangeLabel, goalCount, submitter: { id, displayName }, payload?, markdown?, narrative?, goals } }`; 404 `not_found` when access is null.

- [ ] **Step 1: Failing tests** — four access cases (owner, current manager, reassigned manager → null, admin), cross-org → null; `latestReadingMap` on a v2 and a v1 fixture.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** helper, handler (load packet by `ObjectId`, load owner user, resolve access via session capabilities as the capability middleware does), route, and manager-controller changes. **Step 4: `npm test`** — PASS.
- [ ] **Step 5: Commit** `feat(api): one packet URL for owner, manager, admin`

---

### Task 3: `features/review-packet` domain + `buildPacketPayload`

**Files:**
- Create: `apps/web/src/features/review-packet/index.js`, `build-packet-payload.js`, `packet-model.js` (constants: `PACKET_TEMPLATES = [{ id, label, blurb }]`, `TEMPLATE_IDS`), `use-review-packet.js`
- Modify: `apps/web/package.json` `test:regression` (add `src/features/review-packet/build-packet-payload.test.js`)
- Modify: `CLAUDE.md` shared-domains list (add `review-packet`)
- Test: `apps/web/src/features/review-packet/build-packet-payload.test.js`

**Interfaces:**
- Consumes: `goalReadings` rows as the Evidence page has them (`{ level, goal: { id, title, weightage }, parentL1, spec, reading: { value, statusLabel, statusReason }, verdict: { tier, reasoning, confidence, awaiting, pendingSetup, source? }, evidence: [{ ts, text, link? }] }`) and `untracked` (`[{ id, title, l1Title }]`).
- Produces: `buildPacketPayload({ goalReadings, untracked, submitter, rangeLabel, rangeStart, rangeEnd, cycleKey, windowsFor }) → ReviewPacketPayload` where `windowsFor(goalId, spec) → [{ key, label, state, verdict }]` is injected (the Evidence page passes a function built from `buildCycleWindows` + `readGoalTier(goalId::key)`); `totals.byTier` counts graded L2s per tier; `totals.tracked = goals with a spec`.
- Produces: `useReviewPacket(id) → { loading, packet, error }` (SWR on `/review-packets/:id` via `apiGet`).

- [ ] **Step 1: Failing tests** — fixture with 2 objectives / 3 goals / 1 untracked: objectives grouped by `parentL1.id` with `weight` from `weightage`; `totals` = `{ goals: 4, tracked: 3, byTier: { achieved: 2, overAchieved: 1, notAchieved: 0, roleModel: 0 } }`; a goal with `verdict.awaiting` → `verdict: null`; zero goals → `totals.goals 0` and `objectives []`.
- [ ] **Step 2: Run `cd apps/web && npm run test:regression`** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS (boundaries test sees the new barrel).
- [ ] **Step 5: Commit** `feat(web): review-packet domain + payload builder`

---

### Task 4: `PacketView`, legacy view, packet page, route + hub slot

**Files:**
- Create: `apps/web/src/features/review-packet/packet-view.jsx`, `packet-legacy.jsx`, `packet-page.jsx`, `packet-header.jsx`
- Create: `apps/web/src/app/[hub]/packets/[id]/page.jsx` (client page, `useHubSlotGuard("packets")`, `AppShell`, `PacketPage id`)
- Modify: `packages/shared/src/hubs/registry.js:60-90` (`"packets"` in `PAGE_SLOTS`) and each hub's `pages` map (`packets: "<hub>:packets"` for admin, dev, qa, manager)
- Modify: `apps/web/src/hubs/dashboard-registry.jsx` only if the slot map requires an entry (it doesn't for route-file pages; confirm and skip)
- Test: `packages/shared/src/hubs/registry.test.js` (existing contract test covers the new slot); `apps/web/src/features/review-packet/packet-view.test.js` (add to `test:regression`)

**Interfaces:**
- Produces: `PacketView({ packet, mode: "page" | "preview" })` → renders `templates/<template>.jsx` for v2, `PacketLegacy` for v1 (a `<pre>` + "Download .md"), and a neutral "Unknown template" card otherwise. `selectTemplate(packet) → "legacy" | PacketTemplate | "unknown"` is exported for the test.
- Produces: `PacketPage({ id })` → `PacketHeader` (submitter name, range, template label, `Button` "Copy link", "Download .md" when `markdown`) + `PacketView`. 404 from the API → "This packet isn't yours to see." card.

- [ ] **Step 1: Failing test** — `selectTemplate({ version: 1, markdown: "#" })` → `"legacy"`; `({ version: 2, template: "deck" })` → `"deck"`; `({ version: 2, template: "x" })` → `"unknown"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (templates folder may be stubs that render the goal titles until Tasks 5–8). **Step 4: `npm run test:regression` + `cd packages/shared && npm test`** — PASS.
- [ ] **Step 5: Commit** `feat(web): packet page and view switch`

---

### Task 5: Scorecard template

**Files:**
- Create: `apps/web/src/features/review-packet/templates/scorecard.jsx`, `templates/shared/count-up.jsx`, `templates/shared/tier-chip.jsx`, `templates/shared/weight-ring.jsx`, `templates/shared/motion.js` (`useReducedMotion` wrapper + stagger presets)

**Interfaces:**
- `Scorecard({ payload, mode })`: header strip with `CountUp` totals (goals, tracked, by tier), one section per objective with a `WeightRing` (SVG, token colours) and goal rows (`TierChip` animates scale 0.8→1 on mount, neutral chip when `verdict` null), evidence collapsed under each goal in `page` mode.

- [ ] **Step 1: Implement** with Framer Motion `motion.div` + `staggerChildren`; `motion.js` returns `{ initial: false }` presets when `prefers-reduced-motion`.
- [ ] **Step 2: Empty state** — zero goals → one `Card` "Nothing tracked yet."; rings guard `weight > 0`.
- [ ] **Step 3: Run `npm run test:regression`** (design-system guard) — PASS. **Step 4: Commit** `feat(web): scorecard packet template`

### Task 6: Cycle journey template

**Files:** Create `templates/journey.jsx`, `templates/shared/window-strip.jsx`.

- `Journey({ payload, mode })`: sticky top `WindowStrip` built from the union of every goal's `windows[].key` (sorted), `useScroll` + `useTransform` drives a progress bar; each goal row is a horizontal track of window cells (`state` → tint: done mint, missed peach, before/muted grey, open sky) revealed with `whileInView`; goals without windows render a single full-width cell with the overall chip.
- [ ] Steps: implement → empty state ("No windows in this cycle") → guard pass → commit `feat(web): cycle journey packet template`.

### Task 7: Goal deck template

**Files:** Create `templates/deck.jsx`, `templates/shared/use-deck-nav.js`.

- `Deck({ payload, mode })`: cards = `[cover, ...goals, summary]`; `useDeckNav(count)` handles ← → keys and pointer swipe (`drag="x"`, threshold 80px); `AnimatePresence` slide transitions; progress dots; `preview` mode shows the cover only with a "Open to flip through" hint.
- [ ] Steps: implement → empty state (cover + summary only) → guard pass → commit `feat(web): goal deck packet template`.

### Task 8: Dossier template

**Files:** Create `templates/dossier.jsx`, `templates/shared/tier-seal.jsx`; Modify `apps/web/src/app/globals.css:381-389` (print rules for `.packet-dossier`: white canvas, no shadows, page breaks before objectives).

- `Dossier({ payload, mode })`: `Card` as a paper sheet (max-width 760px), masthead, sections reveal with `staggerChildren`; `TierSeal` is a rotated rounded badge that scales in with `type: "spring"` next to each goal title; evidence listed as dated lines.
- [ ] Steps: implement → empty state → `window.print()` sanity in dev → guard pass → commit `feat(web): dossier packet template`.

---

### Task 9: Evidence page submits v2 with a template picker; viewer renders `PacketView`

**Files:**
- Create: `apps/web/src/features/review-packet/template-picker.jsx`
- Modify: `apps/web/src/features/evidence/evidence-page.jsx:166-180` (`buildDocProps` unchanged), `:202-271` (`handleSubmitForReview` → v2 body), `:317-364` (`SubmitCard` gets `<TemplatePicker value onChange payload />`), `:414-470` (viewer uses `PacketView` + "Open full page" link to `/${hub}/packets/${id}`)
- Modify: `apps/web/src/features/evidence/evidence-summary.jsx` (unchanged copy; confirm it reads `submittedAt` only)

**Interfaces:**
- Consumes: `buildPacketPayload`, `PACKET_TEMPLATES`, `PacketView`, `TemplatePicker` from `@/features/review-packet`.
- `TemplatePicker({ value, onChange, payload })`: four tiles (label + blurb) and a `PacketView mode="preview"` of `{ version: 2, template: value, payload }` beneath. Selection persists per device in `localStorage` key `espace-devhub:packet-template` (try/catch).
- Submit body: `{ version: 2, template, level, rangeLabel, payload, markdown: renderMarkdown({ ...buildDocProps(), include: { ...include, narrative: false, starred: false } }) }`. The pending-readings block and confirm dialog stay as they are.

- [ ] **Step 1: Implement.** **Step 2: Manual check** — `npm run dev`, submit on `/dev/evidence`, open the viewer and the full page, confirm the manager-side list shows `template`. **Step 3: `npm run test:regression`** — PASS.
- [ ] **Step 4: Commit** `feat(web): submit HTML review packets from Evidence`

---

### Task 10: Manager board preview + open link

**Files:**
- Modify: `apps/web/src/hubs/manager/review-packet-card.jsx:30-134` (v2: totals strip + byTier `Badge`s + `Button` "Open packet" → `/${hub}/packets/${latest.id}`; v1: current layout)
- Modify: `apps/web/src/hubs/manager/manager-employee-board.jsx:52-53, 107-116` (header button opens the packet page for v2, downloads markdown for v1)
- Modify: `apps/web/src/hubs/manager/use-review-packets.js` (no change to fetch; export `packetHref(hubId, id)`)
- Modify: `apps/web/src/features/notifications/notification-kinds.js:40,110` (`review_packet_submitted` deep-links to `/packets/<data.packetId>` when present)

- [ ] **Step 1: Implement.** **Step 2: `npm run test:regression`** — PASS (notification inbox-model test covers the kinds table; add a case for the packet link if the table is tested there).
- [ ] **Step 3: Commit** `feat(web): managers open the rendered packet`

---

### Task 11: Docs

**Files:** Modify `CLAUDE.md` "Review packets" row: "Frozen structured payload (v2) rendered by `features/review-packet` as one of four templates; one URL `/[hub]/packets/[id]` for owner, manager, admin; v1 markdown packets still readable."

- [ ] **Step 1: Edit.** **Step 2: Commit** `docs: HTML review packets`
