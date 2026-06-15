# Widget system rethink

Date: 2026-06-15
Author: PO strategy pass (ecc-claude-product-team-agile-product-owner)

> Widgets are the heart of the product: a goal becomes trackable only when it
> becomes a widget. This doc rethinks the whole widget lifecycle around three
> reported problems.

## The core insight

A widget is a **three-way contract** between three actors that today are
authored independently and therefore **drift apart**:

| Actor | Produces | Where |
|---|---|---|
| **Classifier** (AI) | the spec: widget kind, source/manual, `tiers` (4 criteria), `context.questions` | `apps/api/.../classifier/mistral-classifier.ts` |
| **User** | the data: check-in entries + context answers | `goal-inputs`, `goal-context` |
| **Grader** (AI) | the verdict: not_achieved → role_model | `controller.ts` `GOAL_TIER_SYSTEM_PROMPT` + `use-goal-tier.js` `buildCurrentData` |

The classifier writes the **tiers** from the goal *text*, in a vacuum. The
grader reads whatever *live data* happens to exist. Nothing guarantees the
tiers are expressed in the units the widget captures, or that any data exists
yet. When they don't line up, the grader says **"the provided data doesn't
help me rank it"** — exactly the bug reported.

**Everything below is about closing that loop.**

---

## Issue 1 — The grader can't rank ("data doesn't help")

### Root causes (verified in code)
1. **Tiers aren't unit-matched to the metric.** The classifier is *asked* to
   tie tiers to the widget's metric, but it's a soft instruction — it routinely
   emits qualitative/team-scoped criteria the per-developer data can't confirm.
2. **`currentData` is a thin prose blob.** `buildCurrentData()` returns one line
   ("current total: 5"); the grader has to guess the comparison. For AUTO
   widgets it falls back to the snapshot reading, which is **empty for a
   just-created widget** → `currentData = "(no data available yet)"` → the model
   correctly says it can't rank.
3. **"No data yet" is graded as failure** instead of being a distinct state. A
   brand-new widget (no snapshot, no entries) should read *"awaiting data"*, not
   *"not achieved."*
4. **The grader never sees the rubric/criteria the user defined.** `gradeGoalTier`
   gets `tiers` + `currentData` only — not the `goal-context` answers — so for
   rubric/milestone goals it judges blind.

### The fix — make the loop closed and unit-typed
- **Structured tiers.** Each tier carries a machine-checkable `threshold`
  (`{op, value}` in the widget's unit) **plus** the prose. The classifier must
  emit it; the validator enforces it for numeric widgets.
- **Deterministic grading for numeric widgets.** If the tier ladder is numeric
  (counter, scale, all 9 AUTO metrics, %-ratio, OKR), grade by **comparing the
  reading to the thresholds — no AI call.** Instant, free, never "can't rank,"
  and the tier is always consistent with the displayed number. Reserve the AI
  grader for genuinely qualitative widgets (CODE_RUBRIC, milestone quality,
  free-text/journal).
- **Structured reading, not a blob.** Replace `buildCurrentData`'s string with a
  reading object `{ value, unit, window, target, components?, completion? }` so
  both the deterministic grader and the AI grader compare like-for-like.
- **First-class "awaiting data" state.** When there's no usable reading, the tier
  badge shows *"awaiting data"* (with what's missing: "log 1 entry" / "connect
  GitLab" / "capture this week's snapshot") instead of grading emptiness. The
  hub already has `NO_DATA`; the tier UI should defer the same way.
- **Feed context into the grader.** Pass `goal-context` answers (the user's
  rubric/definitions) into the AI grader for qualitative widgets so it judges
  against the user's truth, not a guess.

Net effect: a widget can no longer be "tracked everywhere" yet ungradeable —
the thing that's displayed is the thing that's graded, in the same unit.

---

## Issue 2 — Context collection should be multi-step / multi-resource

### Today (verified)
`context-collector.jsx` renders **all** `spec.context.questions` in **one
form**, the user answers once, then "Save & re-analyze" re-runs the classifier.
Question kinds: `text | list | number | select`. It **cannot**: ask follow-ups
based on an answer, request resources (a rubric doc, a Jira filter, example
PRs, a spreadsheet), or iterate when an answer is too thin. For milestone-style
goals — where the checklist items AND the tier criteria depend almost entirely
on the user's definitions — one shot isn't enough to build a good widget.

### The fix — a conversational "Widget Builder"
Treat widget creation as a short **interview**, not a form submit. A dedicated
builder agent asks → reads → decides if it has enough → asks a follow-up or
requests a resource → repeats → then emits a high-confidence spec + tiers.

- **Phase 2a (cheap, no new AI):** turn the collector into a **wizard** — one
  question per step, with "add another item," and let the classifier append
  *follow-up* questions (a `context.followups` the next pass can add). Add new
  question kinds: `resource_link` (paste a URL — Jira filter, Confluence,
  repo), `file` (upload a rubric/spreadsheet), `examples` (point at 1–3 PRs/
  tickets the widget should learn from).
- **Phase 2b (agentic):** a real back-and-forth using the chat/AI loop. The
  builder can ask N adaptive questions, ingest pasted/linked resources, confirm
  its understanding, and only then write the spec. This is the natural home for
  "absorb more context to make better widgets." Resources become grading
  inputs too (the linked rubric IS the rubric the grader uses).

Design rule: **context is cumulative and re-openable.** The user can come back
and add more context later, and the widget re-scopes — not a one-time gate.

---

## Issue 3 — More widget types

Current catalog (19): 9 AUTO metrics, CODE_RUBRIC, SCORECARD, + 8 manual
(counter, scale, milestone, date-log, free-text, before-after, incident-log,
recurring-milestone). Gaps worth filling:

**Auto (from data we already pull):**
- **REVIEWS_GIVEN** — count of reviews you gave others (mentorship / review load).
- **TIME_TO_FIRST_REVIEW** — how fast you respond to review requests (we already
  compute PR review timings).
- **PR_SIZE** — median lines changed per merged PR ("keep PRs reviewable").
- **ACTIVE_DAYS / COMMIT_CADENCE** — days with activity in the window (consistency).
- **CHANGE_FAIL_RATE** — % deploys/PRs that triggered a revert/incident (DORA).

**Manual / hybrid:**
- **KEY_RESULT (OKR)** — start → target → current with a % progress bar; the
  cleanest numeric ladder, trivially gradeable (the deterministic path above).
- **RATIO / PERCENTAGE** — "X of Y" (e.g. "% PRs with tests"), auto or manual.
- **HABIT / STREAK** — consecutive periods hitting a target (generalises
  recurring-milestone to any metric).
- **SELF_ASSESS_RUBRIC** — periodic self-rating against named criteria (the
  human counterpart to the AI CODE_RUBRIC).
- **PEER_FEEDBACK / 360** — collect ratings from named reviewers (delegated).
- **TIME_ALLOCATION** — % of time across categories (feature / bug / tech-debt /
  mentoring) — a stacked manual entry.
- **LEARNING** — courses/certs with target dates (milestone variant with deadlines).

**Composite presets:**
- **DORA scorecard** — deploy freq + lead time + change-fail + MTTR, pre-wired.

**Meta (bigger):**
- **CUSTOM_METRIC / FORMULA** — let the builder define a metric from available
  data sources + a formula, so new metrics don't each need new widget code. The
  highest-leverage long-term move; depends on the conversational builder.

---

## Sprint plan

### Sprint W1 — Close the grading loop ✅ SHIPPED (03e1bb2 + b198742)
- [x] `tierScale` numeric ladder on the spec (validator) — `{unit, direction,
  achieved, overAchieved, roleModel}`, parallel to the prose `tiers`.
- [x] Deterministic numeric grader (`grade-numeric.js`: gradeNumericTier +
  numericReadingFor) — compares reading vs thresholds, no AI call.
- [x] `useGoalTier` grades deterministic-first; "awaiting data" state when no
  usable reading (no longer grades emptiness); AI grader only for qualitative.
  `setGoalTierVerdict` writes local verdicts; `GoalTierBadge` shows awaiting.
- [x] Classifier emits `tierScale` for numeric widgets (prompt + candidate).
- [x] goal-context answers folded into the AI grader's currentData.
- [ ] *(follow-up)* widen the OpenAI `SPEC_RESPONSE_SCHEMA` (strict json_schema)
  to allow `tierScale` so Mistral/GLM emit it too (Bedrock/direct already do).

### Sprint W2 — Conversational context (fixes Issue 2)
- [ ] Multi-step wizard collector + new kinds (`resource_link`, `file`, `examples`).
- [ ] `context.followups` so a re-analysis can ask adaptive follow-ups.
- [ ] (stretch) Agentic widget-builder loop using the AI chat path.

### Sprint W3 — Catalog expansion (fixes Issue 3)
- [ ] Ship the cheap auto ones first (REVIEWS_GIVEN, TIME_TO_FIRST_REVIEW,
  PR_SIZE, ACTIVE_DAYS) — reuse existing integration data + the data-source
  resolver.
- [ ] KEY_RESULT + RATIO + HABIT (manual, deterministic-gradeable).
- [ ] DORA scorecard preset.
- [ ] (icebox) CUSTOM_METRIC/FORMULA.

## Risks
1. **Classifier prompt is already huge.** Adding structured thresholds + more
   widgets grows it. Mitigate: move the catalog to a compact table + few-shot,
   and consider splitting "pick widget" from "write tiers" into two calls.
2. **Deterministic grading changes verdicts.** Some goals graded by AI today
   will flip. That's correct (consistency), but communicate it.
3. **Agentic builder cost.** Multi-turn context = more tokens. Keep Phase 2a
   (wizard, no AI) as the default; gate 2b behind an explicit "help me build
   this" action.
4. **Migration.** Existing specs lack `threshold` on tiers — grade them via the
   AI path until re-analyzed; new/re-analyzed specs use the deterministic path.
