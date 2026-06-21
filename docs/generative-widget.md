# Generative widget (`COMPOSED`) — design

> The "super generative UI component that can collect and track all the needed
> data accurately, for representation, evidence, and achievement tiering."
>
> Status: **engine shipped (v1, dormant)** — the field vocabulary, validator,
> interpreter, and grader bridge are built and build-verified. The classifier
> does not yet emit `COMPOSED`; that's the explicit next step (see §7).

## 1. The problem it solves

Today a widget *type* is a fixed enum (`SPEC_KINDS`) where each kind is a
hand-written React component in the [registry](../apps/web/src/features/goal-widgets/registry.jsx).
The AI classifier picks one existing kind per goal and fills a spec. That works
until a goal needs a shape no preset captures — e.g. *"per quarter: run the DR
drill (checkbox), measure RTO and RPO (two numbers), attach the findings doc
(link), rate confidence (1–5)."* The closest preset (recurring milestone) can
only hold **binary ticks**, so:

- there is **nowhere to record the actual evidence** (the measured RTO, the doc), and
- the grader sees only checkboxes, so it defaults skeptical and marks
  "Not achieved" for "no documentation" — even though the widget never offered
  a place to put documentation.

The fix is to let the AI **invent the widget it needs as data**, not code.

## 2. Why "as data", not generated code

The literal idea — have the model write a React component live — is a
non-starter here, for reasons the [complexity map](../maps/complexity-map.html)
makes concrete:

- **Security.** Executing model-authored code in the browser is arbitrary code
  execution / XSS in an app that holds provider tokens. Hard no.
- **Build model.** Next.js is build-time compiled; there's no runtime path to
  ingest a new `.tsx` without a build.
- **Grading loop.** The tier grader needs *structured* data. A free-form
  component breaks the closed spec↔data↔grader loop — the exact drift the
  widget rethink fights.

So `COMPOSED` is **schema-driven**: the AI emits a declarative field schema
from a bounded vocabulary; one trusted interpreter renders it; one generic
serializer feeds the grader. New "types" are data → safe, gradeable, no build.

## 3. The field-primitive vocabulary

The classifier may only emit fields of these kinds
([`COMPOSED_FIELD_KINDS`](../packages/shared/src/goal-specs/types.js)) — a
bounded, gradeable set, each mapped to an already-trusted control:

| kind | value | control | notes |
|---|---|---|---|
| `checkbox` | boolean | tick | "did it happen" |
| `counter` | number | −/+ stepper | optional `unit`, `target` |
| `scale` | 1–5 | pill row | rating / confidence |
| `number` | number | numeric input | measured value; optional `unit`, `target` |
| `text` | string | text input | short note |
| `date` | YYYY-MM-DD | date input | when it happened |
| `select` | string | dropdown | requires `options[]` |
| `link` | URL | url input | first-class evidence (doc / PR / runbook) |

A field is `{ id, kind, label, unit?, help?, optional?, options?, target? }`.
Capped at **10 fields** per widget (beyond that it's two goals in a trenchcoat).

## 4. Spec shape

A `COMPOSED` spec adds two blocks (everything else is the normal spec):

```jsonc
{
  "widget": "COMPOSED",
  "kind": "manual",
  "title": "Quarterly Disaster Recovery Drills",
  "composed": { "cadence": "quarterly", "prompt": "Log this quarter's DR drill." },
  "fields": [
    { "id": "executed",  "kind": "checkbox", "label": "Drill executed on schedule" },
    { "id": "scenario",  "kind": "select",   "label": "Scenario", "options": ["Region loss","Ransomware","Provider outage","Data corruption"] },
    { "id": "rto",       "kind": "number",   "label": "RTO measured", "unit": "min" },
    { "id": "rpo",       "kind": "number",   "label": "RPO measured", "unit": "min" },
    { "id": "findings",  "kind": "link",     "label": "Findings doc" },
    { "id": "actions",   "kind": "checkbox", "label": "Prior action items closed" }
  ],
  "tiers": { "achieved": "Drill executed AND documented (scenario, RTO/RPO, findings) AND prior actions closed.", "...": "..." }
}
```

The achievement **tiers** are authored exactly as today — the generative part
is the *inputs*, not the grading rubric, which stays the goal owner's contract.

## 5. How the loop closes

- **Representation** — [`composed-widget.jsx`](../apps/web/src/features/goal-widgets/widgets/composed-widget.jsx)
  interprets `spec.fields[]` and renders the right control per kind, with a live
  "X/Y captured" headline.
- **Collect & track** — the whole record lives in one evolving `goal-inputs`
  entry: `{ values: { [id]: value }, evidence: { [id]: string } }`. Append-only,
  latest wins (same store every manual widget uses).
- **Evidence** — every field carries an optional note / link / measured value
  (reuses [`_milestone-evidence.jsx`](../apps/web/src/features/goal-widgets/widgets/_milestone-evidence.jsx)).
  `link` fields *are* their own evidence.
- **Achievement tiering** — [`use-goal-tier.js`](../apps/web/src/features/goal-tiers/use-goal-tier.js)
  `buildCurrentData` serializes the field values **and** evidence into one
  model-readable line (`RTO measured: 12 min [evidence: …]; Findings doc: <url>`).
  Because that flows into the grader's `currentData`, attaching data
  auto-triggers a re-grade — and the verdict is based on real, structured proof
  instead of a bare boolean.

## 6. What shipped in v1 (this change)

| Layer | File | Change |
|---|---|---|
| Vocabulary | `packages/shared/src/goal-specs/types.js` | `SPEC_KINDS.COMPOSED`, `COMPOSED_FIELD_KINDS`, meta |
| Validation | `packages/shared/src/goal-specs/validator.js` | `validateFields`, `validateComposed`, threaded into `validateSpec`/`buildSpec` |
| Interpreter | `apps/web/src/features/goal-widgets/widgets/composed-widget.jsx` | renders any field schema + per-field evidence |
| Registry | `…/widgets/_register.jsx` | registers `COMPOSED` |
| Grader | `apps/web/src/features/goal-tiers/use-goal-tier.js` | `COMPOSED` case in `buildCurrentData` |

Verified: architecture-boundaries ✓, regression 5/5 ✓, web build ✓, api build ✓.
The engine is **additive and dormant** — nothing emits `COMPOSED` yet, so
existing widgets are untouched. A hand-authored `COMPOSED` spec already renders
and grades end-to-end.

## 7. Next step — let the classifier mint one

The only thing between "engine" and "the app builds its own widget on the spot"
is a classifier branch:

> When no preset `SPEC_KIND` cleanly fits the goal, emit `widget: "COMPOSED"`
> with `composed.cadence` (the cadence the goal needs) and a `fields[]` schema
> drawn **only** from `COMPOSED_FIELD_KINDS`. Prefer a preset when one fits;
> reach for `COMPOSED` for multi-signal goals (a process with steps + measures +
> artifacts).

Files: `apps/api/src/modules/ai/classifier/mistral-classifier.ts` (system prompt
+ a worked `COMPOSED` example), and the JSON-schema/validation path already
accepts it via the shared validator. This is staged separately because the
prompt needs careful iteration (and an api rebuild) — the engine is proven
first so we can author a spec by hand and watch it render + grade before wiring
generation.

## 8. Roadmap beyond v1

- **Period reset.** ✅ SHIPPED. COMPOSED now stores one record per period
  (`{ periodKey, values, evidence }`); the widget shows the current period and
  the cadence stepper fills/backfills any period (shared `<ComposedFields>`).
  The grader reads the CURRENT period's record (`currentPeriodKey`) AND a
  cross-period summary (`composedPeriodSummary`: complete-count + streak of
  consecutive complete periods), so "every quarter fully done" tiers grade.
- **Check-in editor.** Add a compact `COMPOSED` editor to `goal-editors` so
  fields can be filled from the weekly check-in, not just the Goals page.
- **Deterministic sub-grading.** `number`/`counter` fields with a `target` can
  grade deterministically (reuse `grade-numeric.js`) before the AI weighs the
  qualitative remainder.
- **Field-level `tierScale`.** Let a generated field contribute to a numeric
  ladder so a `COMPOSED` widget can be partly machine-graded.

## 9. Guardrails (why this stays safe)

- No code is generated or executed — only a field schema validated against a
  fixed vocabulary (`validateFields` rejects unknown kinds, enforces select
  options, caps field count, de-dupes ids).
- The interpreter renders only the 8 trusted controls; an unknown `kind` can't
  reach it (validation drops it first).
- The grader reads structured values, so the closed loop holds — a generated
  widget is graded the same disciplined way a hand-written one is.
