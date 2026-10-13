# Two-ladder tiers for BYO goals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every BYO (COMPOSED) spec carries a whole-cycle ladder (`tiers`) and a one-window ladder (`cadenceTiers`); the AI generates and grades each in its own scope, and managers edit both inline while approving.

**Architecture:** The shared validator owns the new field and a `resolveLadders()` helper that every reader uses. The API's compose prompt returns both ladders and a scope check rejects cross-scope wording; the grade route takes `scope` and uses a prompt without the pacing rule for windows. Approval endpoints accept edited ladders on approve and write them with `tiersLocked`. The web tier hooks switch to `resolveLadders`, and the approval pages get an editable two-ladder block.

**Tech Stack:** packages/shared (plain JS + node:test), apps/api (Express + zod + node:test via tsx), apps/web (Next 16, React, SWR, node:test via tsx).

**Spec:** `docs/superpowers/specs/2026-10-13-html-review-packets-and-two-ladder-tiers-design.md` §3, §4, §5, §6.

## Global Constraints

- Tier ladder shape is always `{ notAchieved, achieved, overAchieved, roleModel }` of `string | null` (`SpecTiers`).
- `cadenceTiers` is optional on a spec; absent/null means "fall back to `tiers`" and the UI must say so.
- Grade `scope` defaults to `"goal"` so old clients keep working.
- Web: design system v2 (Manrope, tokens only, no hex, `Badge`/`Label`/`Button` from `@/components/ui`), barrel-only cross-feature imports.
- Commit after each task; run the owning package's test script before committing.

## Review Focus

1. A spec with `cadenceTiers: null` saved by an old client → windows must still grade and show the "same ladder" note (Task 1 + Task 7 tests).
2. Manager approves without touching the ladders → spec tiers unchanged and `tiersLocked` not set (Task 5 test).
3. Manager blanks all four rows of one ladder → treated as "not provided", not as a ladder of nulls (Task 5 test).
4. Compose returns `cadenceTiers` with "all 24 weekly…" wording → flagged and retried once, never saved as the window ladder (Task 3 test).
5. Window grade request from an old client without `scope` but with a `periodKey` → graded as a window (Task 2 test).

---

### Task 1: `cadenceTiers` in the shared validator + `resolveLadders`

**Files:**
- Modify: `packages/shared/src/goal-specs/validator.js:1150-1185`
- Modify: `packages/shared/src/goal-specs/types.d.ts:516-524`
- Create: `packages/shared/src/goal-specs/ladders.js`, `ladders.d.ts`
- Modify: `packages/shared/src/goal-specs/index.js` (export `resolveLadders`)
- Modify: `packages/shared/package.json` test script (add `src/goal-specs/ladders.test.js`)
- Test: `packages/shared/src/goal-specs/ladders.test.js`, `packages/shared/src/goal-specs/approval.test.js`

**Interfaces:**
- Produces: `ValidatedSpec.cadenceTiers?: SpecTiers | null` (omitted when absent, like `tierScale`).
- Produces: `resolveLadders(spec, policy) → { final: SpecTiers|null, cadence: SpecTiers|null, cadenceFallback: boolean, finalGoverned: boolean, cadenceGoverned: boolean }` where `policy` is `{ finalTiers?, cadenceTiers? } | null`. Precedence: policy ladder → spec ladder (cadence falls back to `spec.tiers`, setting `cadenceFallback: true`).

- [ ] **Step 1: Write failing tests**

```js
// ladders.test.js
test("cadence falls back to tiers and says so", () => {
  const r = resolveLadders({ tiers: T, cadenceTiers: null }, null);
  assert.deepEqual(r, { final: T, cadence: T, cadenceFallback: true, finalGoverned: false, cadenceGoverned: false });
});
test("spec cadenceTiers used when present", () => { /* cadence === C, cadenceFallback false */ });
test("policy ladders outrank spec ladders independently", () => { /* finalTiers only → finalGoverned true, cadence from spec */ });
// approval.test.js (validator)
test("cadenceTiers round-trips and is omitted when absent", () => {
  assert.deepEqual(validateSpec({ ...base, cadenceTiers: C }).spec.cadenceTiers, C);
  assert.equal("cadenceTiers" in validateSpec(base).spec, false);
});
```

- [ ] **Step 2: Run `cd packages/shared && npm test`** — expect FAIL (`resolveLadders` not exported, `cadenceTiers` dropped).
- [ ] **Step 3: Implement** — in `validator.js` call `validateTiers(obj.cadenceTiers)` and spread `...(cadenceTiers ? { cadenceTiers } : {})` next to `tierScale`; add `ladders.js` with `resolveLadders`; export from `index.js`; add the `.d.ts`.
- [ ] **Step 4: Run `npm test`** — PASS.
- [ ] **Step 5: Commit** `feat(shared): cadenceTiers on specs + resolveLadders`

---

### Task 2: Grade route takes `scope`; window prompt without the pacing rule

**Files:**
- Modify: `apps/api/src/modules/ai/schemas.ts:63-99` (`scope: z.enum(["goal","window"]).optional()`)
- Modify: `apps/api/src/modules/ai/controller.ts:430-470` (split the system prompt), `:605-650` (pick prompt by scope)
- Create: `apps/api/src/modules/ai/tier-prompts.ts`
- Test: `apps/api/src/modules/ai/tier-prompts.test.ts` (add to `apps/api/package.json` test list)

**Interfaces:**
- Produces: `tierSystemPromptFor(scope: "goal" | "window"): string` and `resolveGradeScope(payload: { scope?: string; periodKey?: string }): "goal" | "window"` (window when `scope === "window"` OR `periodKey` is set and not `WHOLE_GOAL_TIER_KEY`).

- [ ] **Step 1: Write failing tests**

```ts
test("window prompt has no pacing rule, goal prompt does", () => {
  assert.match(tierSystemPromptFor("goal"), /judge the PACE/);
  assert.doesNotMatch(tierSystemPromptFor("window"), /judge the PACE/);
  assert.match(tierSystemPromptFor("window"), /ONLY this window/);
});
test("resolveGradeScope: periodKey alone means window", () => {
  assert.equal(resolveGradeScope({ periodKey: "2026-W12" }), "window");
  assert.equal(resolveGradeScope({ periodKey: "__goal__" }), "goal");
  assert.equal(resolveGradeScope({}), "goal");
});
```

- [ ] **Step 2: Run `cd apps/api && npx tsx --test src/modules/ai/tier-prompts.test.ts`** — FAIL.
- [ ] **Step 3: Implement** — move the prompt lines into `tier-prompts.ts`: shared head + tail, the MID-CYCLE block only for `goal`, and for `window` a block: "WINDOW SCOPE: grade ONLY this window's data against the ladder; do not pro-rate or judge pace; a whole-cycle total in a tier means the window cannot reach it — say so." Wire `gradeGoalTierHandler` to `tierSystemPromptFor(resolveGradeScope(payload))` in both the streaming and non-streaming branches.
- [ ] **Step 4: Run the test + `npm test`** — PASS.
- [ ] **Step 5: Commit** `feat(api): scoped tier grading prompt`

---

### Task 3: Compose returns two ladders; cross-scope check

**Files:**
- Modify: `apps/api/src/modules/ai/controller.ts:960-1014` (prompt JSON + rules), `:2277-2340` (`findUngradeableTiers`, `cleanTiers`), `:2497-2610` (handler wiring + `buildSpec({ ..., cadenceTiers })`)
- Test: `apps/api/src/modules/ai/compose-guards.test.ts`

**Interfaces:**
- Produces: `findCrossScopeTiers(tiers, cadenceTiers): string[]` — returns one note per offending ladder: whole-cycle wording (`WHOLE_CYCLE_TIER`) inside `cadenceTiers`, or single-window wording (`/\bthis (week|month|quarter|period|window)\b/i`) inside `tiers`.
- Produces: compose response `spec.cadenceTiers` populated; `unrepresented` gains the scope notes when the retry still fails.

- [ ] **Step 1: Write failing tests**

```ts
test("findCrossScopeTiers flags whole-cycle wording in cadenceTiers", () => {
  const notes = findCrossScopeTiers(null, { roleModel: "All 24 weekly deliverables logged across the 6-month plan" });
  assert.equal(notes.length, 1); assert.match(notes[0], /cadenceTiers/);
});
test("findCrossScopeTiers flags 'this week' in the whole-cycle ladder", () => { /* tiers.achieved "Deliverable marked complete this week" → 1 note */ });
test("clean ladders pass", () => { assert.deepEqual(findCrossScopeTiers(T, C), []); });
```

- [ ] **Step 2: Run `npx tsx --test src/modules/ai/compose-guards.test.ts`** — FAIL.
- [ ] **Step 3: Implement** — prompt: add `"cadenceTiers": {...}` to the JSON shape with the rule "`tiers` = the WHOLE plan (may reference totals across periods); `cadenceTiers` = ONE <cadence> on its own (must NOT reference totals across periods)". Handler: `cleanTiers(parsed?.cadenceTiers)`; when `findCrossScopeTiers` returns notes, re-ask the model once with the notes appended; if still failing, drop the offending ladder (`cadenceTiers → null`, or `tiers` unchanged but notes into `unrepresented`). Pass `cadenceTiers` to both `buildSpec` calls.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `feat(api): compose emits whole-cycle and per-window ladders`

---

### Task 4: Classifier emits `cadenceTiers` for period-reset widgets

**Files:**
- Modify: `apps/api/src/modules/ai/classifier/spec-schema.ts:488-510` (add nullable `cadenceTiers` with the same shape)
- Modify: `apps/api/src/modules/ai/classifier/mistral-classifier.ts:536-586` (prompt: RECURRING_MILESTONE / COMPOSED must also return `cadenceTiers` scoped to one period)
- Create: `apps/api/src/modules/ai/cadence-tiers.ts`
- Test: `apps/api/src/modules/ai/cadence-tiers.test.ts` (add to test list)

**Interfaces:**
- Produces: `deriveCadenceTiers(widget: string, tiers: SpecTiers|null): SpecTiers|null` — for `RECURRING_MILESTONE`/`COMPOSED` with a streak-shaped ladder returns `{ notAchieved: "This period's checklist incomplete", achieved: "This period's checklist fully complete", overAchieved: "Complete with evidence or notes beyond the ask this period", roleModel: "Complete, linked and ahead of schedule this period" }`; other widgets → `null`. Used when the model omits `cadenceTiers`.

- [ ] **Step 1: Write failing test** — `deriveCadenceTiers("RECURRING_MILESTONE", T)` returns the four strings above; `deriveCadenceTiers("MERGED_COUNT", T)` is `null`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** and call it where the classifier result is normalised into a spec (the same place `tiers` is read in `mistral-classifier.ts`).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** `feat(api): classifier per-window ladder`

---

### Task 5: Approval endpoints return both ladders and accept edits on approve

**Files:**
- Create: `apps/api/src/modules/manager/approval-ladders.ts`
- Modify: `apps/api/src/modules/manager/controller.ts:1600-1645` (list), `:1664-1800` (decision)
- Modify: `apps/api/src/modules/admin/approvals-controller.ts:93-200` (list), `:206-320` (decide)
- Test: `apps/api/src/modules/manager/approval-ladders.test.ts` (add to test list)

**Interfaces:**
- Produces: `projectApprovalLadders(spec): { tiers, cadenceTiers, tiersSource: "ai" | "user" }` (`tiersSource = spec.tiersLocked === true ? "user" : "ai"`).
- Produces: `applyApprovedLadders(spec, body: { tiers?: unknown; cadenceTiers?: unknown }): { set: Record<string, unknown>; changed: { tiers: boolean; cadenceTiers: boolean }; errors: string[] }` — validates each provided ladder with the shared `validateSpec` on `{ ...spec, tiers, cadenceTiers, tiersLocked: true }`; a ladder whose four rows are all blank counts as not provided; when nothing is provided `set` is `{}` and `changed` is all false.
- Both decision handlers merge `set` into the `$set` of the approve update, audit `after.tiersChanged`/`after.cadenceTiersChanged`, and append " Your manager adjusted the achievement levels." to the approve notification body when either changed.

- [ ] **Step 1: Write failing tests**

```ts
test("untouched approve changes nothing", () => { assert.deepEqual(applyApprovedLadders(spec, {}).set, {}); });
test("edited cadence ladder is set with tiersLocked", () => {
  const r = applyApprovedLadders(spec, { cadenceTiers: C });
  assert.deepEqual(r.set, { "spec.cadenceTiers": C, "spec.tiersLocked": true });
  assert.deepEqual(r.changed, { tiers: false, cadenceTiers: true });
});
test("all-blank ladder is ignored", () => { /* { tiers: { notAchieved: "", ... } } → set {} */ });
test("invalid ladder returns errors, no set", () => { /* tiers: "nope" → errors.length 1 */ });
test("projectApprovalLadders reports source", () => { /* tiersLocked → "user" */ });
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the helper; wire list handlers to spread `projectApprovalLadders(spec)` into each item; wire decision handlers (400 `invalid_tiers` on errors).
- [ ] **Step 4: Run `npm test`** — PASS.
- [ ] **Step 5: Commit** `feat(api): approve with edited achievement ladders`

---

### Task 6: Manager goal detail projects both ladders

**Files:**
- Modify: `apps/api/src/modules/manager/goal-detail.ts:120-160`
- Test: `apps/api/src/modules/manager/report-surfaces.test.ts` (add one case if it covers `goal-detail`; otherwise `goal-detail.test.ts` added to the list)

**Interfaces:**
- Produces: detail `{ tiers: TierProjection[]|null, cadenceTiers: TierProjection[]|null, cadenceFallback: boolean }` using `resolveLadders(spec, null)`.

- [ ] **Step 1: Failing test** — spec with only `tiers` → `cadenceTiers` equals the `tiers` projection and `cadenceFallback: true`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(api): goal detail carries both ladders`

---

### Task 7: Web tier hooks + dev-facing panels use `resolveLadders`

**Files:**
- Modify: `apps/web/src/features/goal-tiers/use-goal-tier.js:925` (final), `:1360-1375` (cadence + `scope: "window"` in the grade body), `:1425-1465` (`readCappedGoalTier`)
- Modify: `apps/web/src/features/goal-tiers/goal-tier-store.js:225-240, 495-505` (pass `scope` through to `/ai/grade-goal-tier`)
- Modify: `apps/web/src/features/goal-tiers/goal-tier-ui.jsx:96-130` (ladder title "Achievement levels · whole cycle"), `:287-385` (`TierEditor` edits `tiers` and `cadenceTiers` under "Whole cycle" / "Each window" labels)
- Modify: `apps/web/src/features/goal-specs/specs-store.js:286-295` (`updateSpecTiers(goalId, { tiers, cadenceTiers }, locked)`)
- Modify: `apps/web/src/features/goal-widgets/cadence-stepper.jsx:466-531, 754` (render when `cadence` resolves; fallback note)
- Modify: `apps/web/src/features/goal-widgets/compose-widget-modal.jsx:1075-1210` (preview shows both ladders)
- Test: `apps/web/src/features/goal-tiers/ladders-client.test.js` (add to `test:regression`)

**Interfaces:**
- Consumes: `resolveLadders` from `@espace-devhub/shared` (via `@/features/goal-specs` barrel re-export — add `resolveLadders` to that barrel).
- Produces: `gradeRequestBody({ goalId, tiers, currentData, periodKey, scope })` pure helper exported from `goal-tier-store.js` for the test; `updateSpecTiers` signature above.
- `WindowTierPanel` heading: "This window's tier" + `Badge` "Same ladder as the whole goal" when `cadenceFallback`.

- [ ] **Step 1: Failing test** — `gradeRequestBody({... periodKey: "2026-W3", scope: "window"})` includes `scope: "window"`; `updateSpecTiers` with `{ cadenceTiers: C }` leaves `tiers` intact (use the store directly with a seeded spec).
- [ ] **Step 2: Run `cd apps/web && npm run test:regression`** — FAIL.
- [ ] **Step 3: Implement** the hook, store, editor, panel, and preview changes. Tier hash input becomes `JSON.stringify(resolved ladder)` per scope (already per-scope since each hook hashes its own ladder).
- [ ] **Step 4: Run `npm run test:regression`** — PASS (includes design-system guard + boundaries).
- [ ] **Step 5: Commit** `feat(web): window tiers read the per-window ladder`

---

### Task 8: Editable two-ladder block in manager + admin approvals

**Files:**
- Create: `apps/web/src/hubs/manager/approval-ladders.js` (pure state model), `apps/web/src/hubs/manager/approval-ladders-editor.jsx`
- Modify: `apps/web/src/hubs/manager/manager-approvals.jsx:46-120` (state + `decide` payload), `:190-340` (block moves to the top of the body, under the decision bar)
- Modify: `apps/web/src/hubs/admin/admin-approvals.jsx:43-90, 230-260`
- Test: `apps/web/src/hubs/manager/approval-ladders.test.js` (add to `test:regression`)

**Interfaces:**
- Produces: `initLadders(item) → { tiers: Draft, cadenceTiers: Draft, source }` where `Draft = { rows: SpecTiers (strings, "" for null), touched: boolean }`; `editRow(state, ladder, field, value)`; `resetLadder(state, ladder, item)`; `ladderPayload(state) → { tiers?, cadenceTiers? }` (only touched ladders, blanks → null).
- `ApprovalLaddersEditor({ state, onChange, cadenceLabel })` renders two columns ("Whole cycle", `Each ${cadenceLabel}`), one textarea per tier row with the `Badge` tone from `TIER_ROWS`, a "Suggested by AI" badge per ladder until touched, "Reset to AI" link. Approve button copy: "Approve with these levels".
- `decide(item, "approve")` posts `{ decision, note, ...ladderPayload(state) }`.

- [ ] **Step 1: Failing tests** — untouched → `ladderPayload` is `{}`; editing one row marks only that ladder touched and payload carries it with blanks as null; `resetLadder` restores `item.cadenceTiers` and clears touched.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** model, editor, and both pages (replace the read-only block at `manager-approvals.jsx:312-334` and the "No ladder authored" copy with "No levels yet — write them here before approving."). **Step 4: Run `npm run test:regression`** — PASS.
- [ ] **Step 5: Commit** `feat(web): managers set achievement levels while approving`

---

### Task 9: Docs

**Files:** Modify `CLAUDE.md` "What's real vs. stubbed" Tier grading row: add "two ladders per BYO spec (`tiers` whole cycle, `cadenceTiers` per window); managers edit both on approve".

- [ ] **Step 1: Edit.** **Step 2: Commit** `docs: two-ladder tiers`
