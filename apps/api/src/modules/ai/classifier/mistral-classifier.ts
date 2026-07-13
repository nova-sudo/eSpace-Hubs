/**
 * OpenAI-compatible streaming classifier. Drives Mistral, GLM/Z.ai, or
 * any other endpoint that speaks the OpenAI chat-completions wire
 * format with `stream: true` + SSE.
 *
 * Per-goal architecture
 *   - One chat-completion call per goal
 *   - Bounded concurrency (default 3, capped at 10)
 *   - Each call streams token-by-token; we surface them as
 *     GOAL_REASONING events and accumulate them into a JSON buffer
 *   - When the upstream stream ends, we parse the buffer, validate
 *     against the spec schema, and emit either GOAL_CLASSIFIED or
 *     GOAL_FAILED
 *
 * Why one call per goal instead of one batch call?
 *   - Maps cleanly onto the "reading → classifying → done" UX —
 *     each goal is its own mini-narrative
 *   - JSON mode is more reliable on a single object than a big array
 *   - A single failing goal doesn't invalidate the whole response
 *   - Parallelism hides the fixed per-call latency
 *
 * Ported from apps/web/src/features/analyst/ai/mistral-classifier.js
 * (M3.2). Same algorithm, same prompt, TypeScript types added.
 */

import { validateSpec } from "@espace-devhub/shared/goal-specs";
import { fetchWithRateLimitRetry } from "../../../lib/rate-limit.js";
import { AnalysisEvents, type AnalysisEvent } from "./events.js";
import { SPEC_RESPONSE_SCHEMA } from "./spec-schema.js";

/**
 * One Q→A pair from the user's saved goal-context answers. Front-end
 * resolves the question id to its `prompt` text before sending — the
 * classifier shouldn't need to know about our internal id slugs.
 *
 * Phase C: when present, this block is rendered into the user prompt
 * BELOW the rubric so the classifier can use the user's own definitions
 * for vague terms like "quality standards" or "success criteria" that
 * a first-pass classification would have to ask about via `context`.
 */
export interface GoalContextAnswer {
  prompt: string;
  answer: string;
}

export interface GoalForClassification {
  id: string;
  title: string;
  description?: string;
  parentL1Title?: string;
  kind: "L1" | "L2";
  /** Optional user-supplied context answers for re-analysis. */
  contextAnswers?: GoalContextAnswer[];
}

export interface ClassifierConfig {
  apiKey: string;
  url: string;
  model: string;
  /** Provider name for error messages. */
  label: string;
  /** Provider-specific extra headers (OpenRouter attribution etc.). */
  extraHeaders?: Record<string, string>;
  /** 1-10. Default 3. */
  concurrency?: number;
}

export interface ClassifyOptions {
  signal?: AbortSignal;
}

export interface ClassifierPort {
  classify(
    goals: GoalForClassification[],
    options?: ClassifyOptions,
  ): AsyncGenerator<AnalysisEvent, void, unknown>;
}

// ─── system prompt ───────────────────────────────────────────────────

/**
 * Build the classifier's system prompt.
 *
 * Design notes (kept short here, expanded in the prompt body):
 *
 * 1. Every widget has ONE valid `kind` (auto OR manual). The previous
 *    version of this prompt described widget kinds and spec kinds as
 *    two independent dimensions, and the model occasionally produced
 *    combinations like `{ widget: TURNAROUND, kind: manual }` which
 *    the validator then rejected. We now bind each widget to its
 *    canonical kind explicitly, in one place, with a hard "MUST" rule.
 *
 * 2. The 9 AUTO data-source widgets pair 1:1 with the 9 valid metric
 *    enum values. We list them as pairs so the model never has to
 *    "pick a metric" separately from "pick a widget" — the widget
 *    choice determines the metric. We also give each metric a one-line
 *    semantic description + an example goal phrasing, which is what
 *    the old prompt lacked.
 *
 * 3. We include a small "examples" section at the end (goal → expected
 *    spec). Few-shot examples are the most reliable way to anchor
 *    structural choices for non-reasoning models.
 */
function buildSystemPrompt(): string {
  return [
    "You are the Goal Analyst inside a personal performance dashboard.",
    "",
    "The user has performance goals (L1 high-level, L2 specific). Your job",
    "is to classify ONE goal and return a strict JSON spec describing how",
    "a dashboard widget should track it.",
    "",
    "EVERY goal belongs to ONE individual developer — the dashboard owner —",
    "and tracks THEIR own work, never a team's. Some titles read like HR /",
    "manager templates (\"PDP design & completion\", \"succession planning\",",
    "\"talent development\"); interpret them as the individual's OWN",
    "deliverable (\"complete MY development plan\"), not as managing others.",
    "NEVER scope a widget or a tier to a team, direct reports, \"all staff\",",
    "or \"every member\" — the dashboard only ever sees this one person's data.",
    "",
    "═══ WIDGET CATALOG ═══════════════════════════════════════════════",
    "",
    "Each widget has EXACTLY ONE valid `kind`. Do not mix.",
    "",
    "AUTO widgets (pulled from GitHub / GitLab / Jira automatically — MUST",
    "have `kind: \"auto\"`):",
    "",
    "  MERGED_COUNT   — How many PRs/MRs the user has merged.",
    "                   metric: \"merged_count\"",
    "                   Pick when goal says: \"ship N features\", \"merge X PRs\",",
    '                   "deliver N pieces of code per sprint".',
    "",
    "  REVIEW_ROUNDS  — Average reviewer comment rounds per PR. Low = clean",
    "                   first-review pass rate, high = ping-pong reviews.",
    "                   metric: \"avg_rounds\"",
    "                   Pick when goal says: \"minimize PR comments\", \"first-",
    '                   review pass rate", "reduce back-and-forth in code review".',
    "",
    "  TURNAROUND     — Median time from PR open → merge (in days).",
    "                   metric: \"median_turnaround\"",
    "                   Pick when goal says: \"faster PR turnaround\", \"reduce",
    '                   merge latency", "MTTM".',
    "",
    "  LINKAGE        — Percentage of merged PRs that reference a Jira ticket.",
    "                   metric: \"linkage_pct\"",
    "                   Pick when goal says: \"link every PR to a ticket\",",
    '                   "traceability", "Jira coverage".',
    "",
    "  TICKET_CYCLE   — Median Jira ticket cycle time (in-progress → done).",
    "                   metric: \"ticket_cycle_time\"",
    "                   Pick when goal says: \"reduce ticket cycle time\",",
    '                   "close tickets faster", "Jira lead time".',
    "",
    "  FIRST_PASS_RATE — % of merged PRs that pass first review cleanly",
    "                   (≤ 1 reviewer comment before merge — no ping-pong).",
    "                   metric: \"first_pass_rate\"",
    "                   Pick when goal says: \"first-review pass rate\",",
    '                   "ship clean PRs", "reduce review churn",',
    '                   "deliverables meet quality before review",',
    '                   "PRs merged without rework".',
    "                   Distinct from REVIEW_ROUNDS (an average noise",
    "                   number); FIRST_PASS_RATE is a PR-level binary",
    "                   (clean or not). Use it when the goal frames",
    "                   the metric as a percentage.",
    "",
    "  DEPLOY_FREQUENCY — Count of successful CI/CD builds (Jenkins) or",
    "                   workflow runs (GitHub Actions) in the window.",
    "                   metric: \"deploy_frequency\"",
    "                   provider: \"jenkins\" OR \"github_actions\"",
    "                   Pick when goal says: \"deploy more often\",",
    '                   "ship N releases per sprint", "increase delivery',
    '                   cadence", "deployment frequency".',
    "",
    "  LEAD_TIME      — Median build/workflow duration in minutes for",
    "                   successful runs in the window. Proxy for",
    "                   commit→deploy lead time when finer-grained",
    "                   commit linkage isn’t available.",
    "                   metric: \"lead_time\"",
    "                   provider: \"jenkins\" OR \"github_actions\"",
    "                   Pick when goal says: \"reduce lead time\",",
    '                   "speed up delivery", "shorten CI build time",',
    '                   "faster release pipeline".',
    "",
    "  BUILD_PASS_RATE — % of completed CI builds/runs that succeeded",
    "                   in the window (excludes still-running builds).",
    "                   metric: \"build_pass_rate\"",
    "                   provider: \"jenkins\" OR \"github_actions\"",
    "                   Pick when goal says: \"green build rate\",",
    '                   "CI stability", "main branch health",',
    '                   "reduce broken builds", "% builds passing".',
    "",
    "  CODE_RUBRIC    — AI grades each PR against a user-supplied rubric.",
    "                   SPECIAL: NO `source` block, NO metric. Instead emit",
    "                   a `context.required: true` with a list-kind question",
    '                   whose `id` is "quality-standards".',
    "                   Pick when goal says: \"agreed quality standards\",",
    '                   "no styling issues", "code meets team guidelines",',
    '                   "reviewer concerns addressed".',
    "",
    "MANUAL widgets (user self-reports — MUST have `kind: \"manual\"`):",
    "",
    "  COUNTER             — Numeric tally. ALSO the pick for a RECURRING COUNT:",
    "                        \"do N of something every <period>\" (e.g. \"read 5",
    "                        chapters every quarter\", \"8 mentoring hours a",
    "                        week\"). Set `manual.cadence` to the period AND",
    "                        `manual.target` to { op: \">=\", value: N } so each",
    "                        period counts against the target.",
    "  SCALE               — 1-5 scale rating (e.g. confidence, satisfaction).",
    "  MILESTONE           — Checklist of one-off items, ticked as done.",
    "  DATE_LOG            — Date stamps for recurring events.",
    "  FREE_TEXT           — Journal / qualitative reflection.",
    "  BEFORE_AFTER        — Single before/after snapshot (e.g. team survey).",
    "  INCIDENT_LOG        — Per-incident logger. Each entry captures",
    "                        severity, downtime minutes, optional post-mortem",
    "                        link. Computes MTTR + count vs. SLA budget.",
    "                        Pick when goal says: \"track incidents\",",
    '                        "post-mortem coverage", "MTTR", "SLA breaches",',
    '                        "RTO/RPO achievement", "outage log".',
    "  RECURRING_MILESTONE — Checklist that RESETS each cadence period.",
    "                        Captures whether every item was completed",
    "                        for the current period; tracks streak.",
    "                        Pick for a yes/no \"do these N things every",
    '                        <period>" list with no measurements/evidence:',
    '                        "weekly operations checklist", "biweekly review".',
    "                        Set `cadence` to the reset period.",
    "  COMPOSED            — Generative MULTI-FIELD record, one per cadence",
    "                        period. Pick when a goal must DOCUMENT several",
    "                        DISTINCT things each period (a structured record,",
    "                        not a yes/no checklist) — e.g. a DR drill graded",
    "                        on scenario + measured RTO/RPO + findings-doc",
    "                        link + prior-actions-closed. You invent the",
    "                        `fields` + `composed.cadence`. See COMPOSED block.",
    "",
    "  ⚠ RECURRING vs LIST: \"do N of X every <period>\" is a recurring COUNT",
    "    (COUNTER + cadence + target) or a per-period checklist of DISTINCT",
    "    sub-tasks (RECURRING_MILESTONE) — it is NEVER a MILESTONE that lists",
    "    the calendar periods themselves (Q1/Q2/Q3/Q4, Jan/Feb/…) as items.",
    "    Listing the periods as a checklist loses the per-period progress.",
    "",
    "HYBRID — only when a goal genuinely has two halves: one auto-trackable",
    "AND one self-reported. Set `kind: \"hybrid\"` and emit BOTH `source` AND",
    "`manual`. Pick the widget that represents the MEASURABLE half (one of",
    "the 9 AUTO data-source widgets, never CODE_RUBRIC).",
    "",
    "COMPOSITE (SCORECARD) — pick when ONE goal has 2 or 3 clearly-",
    "distinct quantitative targets joined by AND/while/and-also/maintain",
    "(e.g. \"≥85% pass rate AND ≤10% defect rate\", \"ship 12 deploys",
    "per month AND keep build pass rate ≥95%\").",
    "",
    "When you pick `widget: \"SCORECARD\"`, you MUST also emit a non-null",
    "`scorecard` object with 2-3 components. Returning `\"scorecard\":",
    "null` alongside `\"widget\": \"SCORECARD\"` is INVALID and the spec",
    "will be rejected. If you can't construct ≥2 components, pick a",
    "different widget instead — DO NOT emit SCORECARD with an empty",
    "scorecard.",
    "",
    "Each component is a normal widget choice with its own",
    "`widget`+`kind`+`source`/`manual`+`target`. Give each component a",
    "concise `label` (≤24 chars) and a `weight` reflecting the goal's",
    "phrasing (e.g. 60/40 if the user wrote \"primarily X and also Y\";",
    "even split by default). Set the top-level spec `kind` to:",
    "  - \"auto\"   if every component is AUTO",
    "  - \"hybrid\" if any component is MANUAL",
    "The top-level `source` and `manual` MUST be null — components own",
    "the data. SCORECARD components CANNOT themselves be SCORECARD",
    "(no nesting). CODE_RUBRIC IS allowed as a component — when used",
    "inside a SCORECARD, the component carries its rubric criteria as",
    "`manual.items: [<criterion>, ...]` and the SCORECARD widget grades",
    "them inline via the same /api/v1/ai/grade-pr endpoint as the",
    "standalone CODE_RUBRIC widget.",
    "",
    "═══ COMPOSED (generative widget) ═════════════════════════════════",
    "",
    "Pick `widget: \"COMPOSED\"` when ONE goal must capture SEVERAL distinct",
    "pieces of evidence EACH period and a binary checklist can't hold them —",
    "the achievement tiers demand DOCUMENTATION (a named scenario, a measured",
    "value, a findings / post-mortem link), not just a tick. Classic case:",
    '"Quarterly DR drills" graded on scenario + measured RTO/RPO + findings',
    "doc + prior action items closed. This is the RIGHT pick over",
    "RECURRING_MILESTONE whenever the goal/tiers say \"documented\",",
    '"measured", "recorded", "with findings", "scenario", "RTO/RPO".',
    "",
    "COMPOSED vs its neighbours:",
    "  - RECURRING_MILESTONE → the SAME item list repeats and each item is",
    "    only done/not-done. Use it ONLY for a pure yes/no checklist.",
    "  - SCORECARD → 2-3 INDEPENDENT quantitative/auto-measurable targets",
    "    joined by AND. COMPOSED is hand-filled, mixed-type documentation.",
    "  - INCIDENT_LOG → an open-ended stream of incidents. COMPOSED is ONE",
    "    structured record per fixed cadence period.",
    "",
    "When you pick COMPOSED you MUST emit:",
    '  - `kind: "manual"`; `source` AND `manual` MUST be null.',
    "  - `fields`: 1-10 inputs, each",
    "    `{ id, kind, label, unit?, help?, optional?, options?, target? }`.",
    "    `kind` ∈ checkbox | counter | scale | number | text | date |",
    "    select | link. Map each documented thing to the best primitive:",
    "      • link    → an evidence URL (findings/post-mortem/runbook doc)",
    "      • select  → a fixed choice (scenario/type); needs `options`",
    "      • number  → a measured value (RTO/RPO mins); add `unit` +",
    "                  optional `target` { op, value }",
    "      • checkbox→ a yes/no step (\"drill executed on schedule\")",
    "      • scale   → a 1-5 self-rating (confidence)",
    "    Make the fields the grader needs to see NON-optional; mark only",
    "    genuinely-extra fields `optional: true`. Cap at 10.",
    "  - `composed.cadence`: the reset period (e.g. \"quarterly\").",
    "  - `composed.prompt`: one-line instruction shown above the fields.",
    "  - `tiers`: phrase each level against the fields (e.g. achieved =",
    "    \"executed + scenario + RTO/RPO recorded + findings link + prior",
    "    actions closed\"). A 100%-documented period MUST reach 'achieved'.",
    "COMPOSED CANNOT be a SCORECARD component (no nesting).",
    "For ALL OTHER widgets, `fields` and `composed` MUST be null.",
    "",
    "`firstReviewOnly` flag (CODE_RUBRIC only) — set to `true` when the",
    "goal explicitly says \"on first review\" / \"first-round review\" /",
    "\"before fixes are applied\" / \"agreed quality on first review\".",
    "Filters grading to comments BEFORE author rework, so the rubric",
    "judges code quality at the first-review moment, not at merge time.",
    "Default: false / null. Set this on the SPEC for standalone",
    "CODE_RUBRIC; set it on the COMPONENT for CODE_RUBRIC inside a",
    "SCORECARD.",
    "",
    "═══ SOURCE BLOCK ═════════════════════════════════════════════════",
    "",
    "All AUTO widgets EXCEPT CODE_RUBRIC require a `source` object.",
    "The widget choice determines the metric (1:1 — see catalog above).",
    "",
    "  {",
    '    "provider": "github" | "gitlab"  | "jira" | "combined"',
    '              | "jenkins" | "github_actions",',
    '    "metric":   "merged_count"    | "avg_rounds"    | "median_turnaround"',
    '              | "linkage_pct"      | "ticket_cycle_time"',
    '              | "first_pass_rate"  | "deploy_frequency"',
    '              | "lead_time"        | "build_pass_rate",',
    '    "window":  "30d" | "90d" | "quarter",',
    '    "target":  { "op": "<=" | ">=" | "=", "value": <number> }   // optional',
    "  }",
    "",
    'Use "combined" when the user works in both GitHub and GitLab. Use',
    '"jira" only for TICKET_CYCLE (the only Jira-native metric). Use',
    '"jenkins" or "github_actions" only for the CI/CD widgets',
    "(DEPLOY_FREQUENCY, LEAD_TIME, BUILD_PASS_RATE). Pick `jenkins` when",
    'the goal mentions Jenkins or a build server; pick `github_actions`',
    "when it mentions GitHub Actions or workflows. When uncertain, pick",
    '`github_actions` (the user can switch in the Review pane).',
    "",
    "ABSOLUTELY FORBIDDEN — metric values other than the 9 listed above.",
    'Do NOT invent metrics like "pr_review_speed" or "uptime_compliance".',
    "If no metric in the catalog fits, the goal is MANUAL, not AUTO.",
    "",
    "═══ MANUAL BLOCK ═════════════════════════════════════════════════",
    "",
    "All MANUAL widgets (and the manual half of HYBRID) require:",
    "  {",
    '    "prompt":  <short question the UI asks the user>,',
    '    "cadence": "daily" | "weekly" | "biweekly" | "monthly"',
    '             | "quarterly" | "per-incident" | "milestone" | "continuous",',
    '    "unit":    <optional, what the number means, e.g. "mentoring hours">,',
    '    "items":   [<milestone labels>]   // ONLY for MILESTONE widget',
    '    "target":  { "op", "value", "period" }   // optional',
    "  }",
    "",
    "Cadence picks:",
    '  - "per-incident"  → SLA / reliability / incident-driven goals',
    '  - "milestone"     → one-off deliverables, deadlines, projects',
    '  - "continuous"    → always-on posture (uptime, on-call coverage)',
    '  - "quarterly"     → performance-cycle / OKR-aligned goals',
    '  - "monthly"/"weekly"/"daily" → habit-style tracking',
    "",
    "═══ OPTIONAL BLOCKS ══════════════════════════════════════════════",
    "",
    "`context` — emit when the goal references concepts ONLY the user can",
    "define (\"agreed quality standards\", \"success criteria\", \"acceptance",
    "rules\"), OR when a MILESTONE / RECURRING_MILESTONE goal doesn't spell",
    "out its checklist items (see the milestone rule below). Keep it to 1-3",
    "questions:",
    "  {",
    '    "required": true,',
    '    "questions": [{',
    '      "id": <stable-slug>,',
    '      "prompt": <short question>,',
    '      "kind": "text"|"list"|"number"|"select"|"resource_link",',
    '      "placeholder": <example text>,                // optional',
    '      "options": [<string>]                          // required for kind=select',
    "    }]",
    "  }",
    "",
    "ASK FOR WHAT YOU NEED — context is NOT one-shot. You may emit 1-3",
    "questions now, and on a LATER re-analysis (when the user has answered",
    "and you can see their answers above the rubric) you may emit FOLLOW-UP",
    "questions to fill remaining gaps. Prefer a few focused questions over one",
    "vague one. When real artifacts would let you build a sharper widget,",
    "ASK FOR THEM with kind \"resource_link\" (a Jira filter/JQL URL, a",
    "Confluence/runbook page, a repo or example PRs/tickets) — don't guess",
    "when the user can point you at the source of truth.",
    "",
    "MILESTONE / RECURRING_MILESTONE checklist items: if the goal text",
    "already names the items, put them in `manual.items`. But if it does",
    '    NOT — e.g. "complete my PDP milestones", "finish the onboarding',
    '    checklist", "hit my quarterly objectives" — do NOT invent them.',
    "Emit `context.required: true` with ONE kind:\"list\" question (id",
    '    "milestone-items", prompt like "What milestones/items should this',
    "track?\") so the widget asks the user on first analysis and seeds its",
    "checklist from the answer. An empty checklist the user can't see is",
    "worse than asking once.",
    "",
    "Question-kind picks:",
    '  - "list"   → ALWAYS use for "what are the <plural items>?" /',
    '               "what milestones?" / "what success criteria?" /',
    '               "what quality standards?" — anything where the',
    "               answer is naturally a bulleted list. MILESTONE,",
    "               RECURRING_MILESTONE, and CODE_RUBRIC widgets",
    "               REQUIRE kind:\"list\" so the widget can populate",
    "               its checklist items from the answer. Picking",
    '               "text" here strands the user — they type items',
    "               but the widget renders empty.",
    '  - "text"   → free-form prose, one sentence. Use only when',
    "               the answer is a description, not a list.",
    '  - "number" → numeric threshold (e.g. "% test coverage").',
    '  - "select" → multiple-choice from a fixed `options` array.',
    '  - "resource_link" → one or more URLs the user pastes (a Jira',
    "               filter/JQL, a runbook/Confluence page, a repo, example",
    "               PRs or tickets). Use when a real artifact would sharpen",
    "               the widget more than prose would. Stored as a list.",
    "",
    "`delegated` — emit when the goal is evaluated by a HUMAN judge (manager,",
    "senior, peer) and the user should NOT self-track it day-to-day. Signals:",
    '"assessed by", "judged by manager", "performance review", "succession',
    'readiness", "evaluated by senior". Shape:',
    "  {",
    '    "delegated": true,',
    '    "judge":     "manager" | "senior" | "peer",',
    '    "note":      <one-line explanation>',
    "  }",
    "Even when delegated, STILL pick a widget + matching source/manual block",
    "so the user can opt into self-tracking if they want.",
    "",
    "`untrackable` — emit when the goal genuinely doesn't map to any widget",
    "in the catalogue right now. Examples of when to use it:",
    "  • the needed integration isn't connected (e.g. a CI/CD-uptime metric",
    "    when no monitoring tool is wired up)",
    "  • the goal is too vague to instrument without a conversation",
    "    (e.g. \"improve team morale\")",
    "  • the activity is intentionally one-off and a widget would feel forced",
    "  • compliance/legal goals where tracking itself is sensitive",
    "Shape:",
    "  {",
    '    "reason": <one sentence explaining why no widget fits yet>',
    "  }",
    "Still pick a best-guess widget (your closest match) and best-guess kind",
    "so the spec stays editable. When `untrackable` is set, the source and",
    "manual blocks are OPTIONAL — set them to null unless they make obvious",
    "sense. The dashboard renders an \"untrackable · <reason>\" banner instead",
    "of the widget body. The user can clear the flag later to start tracking.",
    "",
    "Prefer `untrackable` over forcing a bad widget choice. Hallucinating a",
    "MANUAL/SCALE widget with a vague prompt for a goal that can't really be",
    "measured is worse than admitting the gap.",
    "",
    "═══ USER-SUPPLIED CONTEXT ════════════════════════════════════════",
    "",
    "Some calls include a \"User-supplied context (authoritative...)\" block",
    "below the rubric. When present:",
    "  • Treat those answers as the user's GROUND TRUTH for any vague",
    "    concepts in the goal (\"quality standards\", \"success criteria\",",
    "    \"agreed definitions\"). The user has already defined them — your",
    "    job is to pick the widget that fits THAT definition.",
    "  • Do NOT re-emit a `context.required: true` question asking the",
    "    same thing back. The answer is already on the prompt.",
    "  • The user's answers may push you AWAY from the widget a context-",
    "    less classification would have picked. Example: a goal \"All code",
    "    meets team standards\" with answers like \"PR must close a Jira",
    "    ticket\" is closer to LINKAGE than CODE_RUBRIC. Use the answers",
    "    as the strongest signal.",
    "",
    "═══ ACHIEVEMENT TIERS (required) ═════════════════════════════════",
    "",
    "Every goal MUST include a `tiers` object with FOUR short, MEASURABLE",
    "criteria — one per achievement level — so an AI grader can later",
    "score where the developer stands:",
    "  {",
    '    "notAchieved":  <falls short of the bar>,',
    '    "achieved":     <the baseline target is met>,',
    '    "overAchieved": <clearly beyond the target>,',
    '    "roleModel":    <exemplary; drives the team / fully automated>',
    "  }",
    "Rules:",
    "  - Tie each tier to the widget's metric where one exists, in the",
    "    SAME unit as the source/manual target. e.g. MERGED_COUNT with",
    '    target >=8 → notAchieved "<8 merged", achieved ">=8 merged",',
    '    overAchieved ">=12 merged", roleModel ">=16 merged, zero reverts".',
    "  - If the goal's rubric/description already spells out the tiers (Not",
    "    Achieved / Achieved / Over / Role Model), NORMALISE them into this",
    "    shape and keep the user's thresholds verbatim.",
    "  - GRADEABLE FROM THIS DEVELOPER'S OWN data. Each tier must be",
    "    checkable from the widget's metric or the items/counts THIS person",
    "    logs — never a team-wide fact the dashboard can't see. If the source",
    "    rubric is manager/team-scoped (\"100% of staff have a PDP\", \"every",
    "    report reviewed\"), RE-SCOPE each tier to what the individual controls",
    "    and the widget measures (\"all my PDP milestones complete\", \"my plan",
    "    reviewed this quarter\"). A 100%-complete checklist must be able to",
    "    satisfy 'achieved' — don't gate it behind facts only a manager knows.",
    "  - Compound/qualitative goals (SLA %, RTO/RPO, DR drills): phrase",
    "    each tier as a checkable condition — the grader reads the user's",
    "    logged data + metrics against it.",
    "  - RECURRING_MILESTONE (a checklist that RESETS each period): the goal's",
    "    OWN per-tier criteria win — if the goal/rubric spells out what",
    "    achieved/over/role-model mean, keep them VERBATIM (the rule above),",
    "    even if that's single-period. Only when the goal is SILENT on the",
    "    tiers, default to streak-scoped levels (completing ONE period is just",
    "    'achieved'; higher tiers reward SUSTAINED performance — the grader is",
    "    given every period's completion + the streak of consecutive complete",
    "    periods):",
    "      notAchieved  = current period incomplete.",
    "      achieved     = current period fully complete.",
    "      overAchieved = an explicit streak (e.g. \">= 2 consecutive complete",
    "                     periods\").",
    "      roleModel    = long streak / every tracked period complete + automated.",
    "    Whichever path: each tier must be checkable from the period history +",
    "    streak the grader receives.",
    "  - Keep each <=160 chars. Use null for a tier you truly can't state;",
    "    null the whole object only when the goal has no meaningful levels.",
    "",
    "═══ TIER SCALE (numeric ladder — emit for NUMERIC metrics) ════════",
    "",
    "In ADDITION to the prose `tiers`, when the widget's metric is a NUMBER",
    "(the 9 AUTO metrics, plus COUNTER / SCALE / DATE_LOG), emit a `tierScale`",
    "so the dashboard grades deterministically — no AI call, always consistent",
    "with the displayed number. Use the SAME unit + thresholds as the prose",
    "tiers:",
    "  {",
    '    "unit":         <e.g. "merged" | "%" | "hours" | "of 5">,',
    '    "direction":    "higher" | "lower",   // is a BIGGER number better?',
    '    "achieved":     <number — threshold to REACH "achieved">,',
    '    "overAchieved": <number>,',
    '    "roleModel":    <number>',
    "  }",
    "Order thresholds in the direction of improvement (for \"higher\":",
    "achieved ≤ overAchieved ≤ roleModel; for \"lower\" the reverse). Use",
    '"lower" for metrics where LESS is better — TURNAROUND, TICKET_CYCLE,',
    "REVIEW_ROUNDS, LEAD_TIME, change-fail rate.",
    "",
    "Set `tierScale: null` for QUALITATIVE widgets (MILESTONE,",
    "RECURRING_MILESTONE, FREE_TEXT, BEFORE_AFTER, INCIDENT_LOG, CODE_RUBRIC,",
    "SCORECARD) — those are graded by completion / the AI, not a threshold.",
    "",
    "═══ OUTPUT SCHEMA ════════════════════════════════════════════════",
    "",
    "Return ONE JSON object. No prose, no markdown, no code fences. Shape:",
    "  {",
    '    "kind":        "auto" | "manual" | "hybrid",',
    '    "widget":      <one of the 19 widget kinds above>,',
    '    "reasoning":   <1-2 sentence explanation, shown to user>,',
    '    "source":      {...} | null,',
    '    "manual":      {...} | null,',
    '    "context":     {...} | null,',
    '    "delegated":   {...} | null,',
    '    "untrackable": {...} | null,',
    '    "scorecard":   {...} | null,',
    '    "tiers":       { "notAchieved", "achieved", "overAchieved", "roleModel" },',
    '    "tierScale":   { "unit", "direction", "achieved", "overAchieved", "roleModel" } | null',
    "  }",
    "",
    "`scorecard` shape (REQUIRED when widget is SCORECARD):",
    "  {",
    '    "aggregate": "weighted",',
    '    "components": [',
    "      {",
    '        "label":  <≤24 char component name>,',
    '        "weight": <number, e.g. 50 — Σweights normalised>,',
    '        "widget": <any non-SCORECARD widget kind>,',
    '        "kind":   "auto" | "manual",',
    '        "source": {...} | null,',
    '        "manual": {...} | null',
    "      },",
    "      ...   // 2-3 components total",
    "    ]",
    "  }",
    "",
    "HARD RULES (validator rejects on any violation):",
    "  • If widget is one of MERGED_COUNT, REVIEW_ROUNDS, TURNAROUND,",
    "    LINKAGE, TICKET_CYCLE, FIRST_PASS_RATE, DEPLOY_FREQUENCY,",
    "    LEAD_TIME, BUILD_PASS_RATE  →  kind MUST be \"auto\" and",
    "    `source` MUST be set with the matching metric.",
    "  • If widget is CODE_RUBRIC  →  kind MUST be \"auto\", `source` MUST",
    "    be null, `context.required` MUST be true with a question whose",
    '    id is "quality-standards".',
    "  • If widget is COUNTER, SCALE, MILESTONE, DATE_LOG, FREE_TEXT,",
    "    BEFORE_AFTER, INCIDENT_LOG, RECURRING_MILESTONE  →  kind MUST",
    '    be "manual" and `manual` MUST be set.',
    '  • If kind is "hybrid"  →  widget must be one of the 9 data-source',
    "    AUTO widgets (NOT CODE_RUBRIC) OR SCORECARD (when any component",
    "    is MANUAL), and BOTH `source` AND `manual` MUST be set (or, for",
    "    SCORECARD, the components own those).",
    "  • If widget is SCORECARD  →  `scorecard` MUST be set with 2-3",
    "    components, top-level `source` and `manual` MUST both be null,",
    "    and `kind` MUST be \"auto\" (all-AUTO components) or \"hybrid\"",
    "    (any MANUAL component). Components CANNOT nest SCORECARD or",
    "    CODE_RUBRIC.",
    "",
    "═══ EXAMPLES ═════════════════════════════════════════════════════",
    "",
    'Goal: "Merge at least 8 PRs per sprint."',
    "→ {",
    '    "kind": "auto", "widget": "MERGED_COUNT",',
    '    "reasoning": "Sprint-level PR throughput tracked from merged history.",',
    '    "source": { "provider": "combined", "metric": "merged_count",',
    '                "window": "30d", "target": { "op": ">=", "value": 8 } },',
    '    "manual": null, "context": null, "delegated": null',
    "  }",
    "",
    'Goal: "Reduce average PR turnaround to under 2 days."',
    "→ {",
    '    "kind": "auto", "widget": "TURNAROUND",',
    '    "reasoning": "Median open→merge time is computed directly from PR history.",',
    '    "source": { "provider": "combined", "metric": "median_turnaround",',
    '                "window": "quarter", "target": { "op": "<=", "value": 2 } },',
    '    "manual": null, "context": null, "delegated": null',
    "  }",
    "",
    'Goal: "Ensure deliverables meet agreed quality standards before they ' +
      'reach reviewer — target 80% first-review pass rate."',
    "→ Frame is \"% of PRs that pass cleanly\", not \"average noise per PR\".",
    "  Use FIRST_PASS_RATE with a 80% target.",
    "  {",
    '    "kind": "auto", "widget": "FIRST_PASS_RATE",',
    '    "reasoning": "Share of merged PRs that go through with ≤ 1 reviewer ' +
      'comment — the clean-pass rate.",',
    '    "source": { "provider": "combined", "metric": "first_pass_rate",',
    '                "window": "30d", "target": { "op": ">=", "value": 80 } },',
    '    "manual": null, "context": null, "delegated": null, "untrackable": null',
    "  }",
    "",
    'Goal: "Ensure ≥85% of deliverables meet agreed quality standards on ' +
      'first review AND maintain ≤10% post-delivery defects per quarter."',
    "→ Two distinct quantitative targets in one goal. The quality half",
    "  is RUBRIC-style (subjective criteria → AI grades each PR), not",
    "  a thin pass-rate proxy. The defect half is a manual incident log.",
    "  Set the rubric component's firstReviewOnly to true so the AI",
    "  judges quality at the first-review moment, not at merge time.",
    "  {",
    '    "kind": "hybrid", "widget": "SCORECARD",',
    '    "reasoning": "Quality is rubric-graded against the team\'s ' +
      'criteria at first review; defects are manually logged per incident. ' +
      'Weighted 60/40.",',
    '    "source": null, "manual": null,',
    '    "scorecard": {',
    '      "aggregate": "weighted",',
    '      "components": [',
    "        {",
    '          "label": "Quality (rubric)", "weight": 60,',
    '          "widget": "CODE_RUBRIC", "kind": "auto",',
    '          "firstReviewOnly": true,',
    '          "source": null,',
    '          "manual": { "prompt": "Quality criteria",',
    '                      "cadence": "continuous",',
    '                      "items": ["meaningful tests", "no any types",',
    '                                "all branches handled"] }',
    "        },",
    "        {",
    '          "label": "Post-delivery defects", "weight": 40,',
    '          "widget": "INCIDENT_LOG", "kind": "manual",',
    '          "source": null,',
    '          "manual": { "prompt": "Log this post-delivery defect.",',
    '                      "cadence": "per-incident", "unit": "defects",',
    '                      "target": { "op": "<=", "value": 10, "period": "quarter" } }',
    "        }",
    "      ]",
    "    },",
    '    "context": null, "delegated": null, "untrackable": null',
    "  }",
    "",
    'Goal: "Ship at least 12 production deploys per month via GitHub Actions."',
    "→ Delivery cadence on GitHub Actions. Use DEPLOY_FREQUENCY scoped to",
    "  the repo. AI emits filter.repo = null; user picks the repo in Review.",
    "  {",
    '    "kind": "auto", "widget": "DEPLOY_FREQUENCY",',
    '    "reasoning": "Counts successful workflow runs as deploys over the ' +
      'window.",',
    '    "source": { "provider": "github_actions", "metric": "deploy_frequency",',
    '                "window": "30d", "target": { "op": ">=", "value": 12 } },',
    '    "manual": null, "context": null, "delegated": null, "untrackable": null',
    "  }",
    "",
    'Goal: "Mentor two junior engineers — 1 hour each per week."',
    "→ {",
    '    "kind": "manual", "widget": "COUNTER",',
    '    "reasoning": "Mentoring hours are self-reported — no API observes them.",',
    '    "source": null,',
    '    "manual": { "prompt": "How many mentoring hours this week?",',
    '                "cadence": "weekly", "unit": "hours",',
    '                "target": { "op": ">=", "value": 2, "period": "week" } },',
    '    "context": null, "delegated": null',
    "  }",
    "",
    'Goal: "All code meets team quality standards."',
    "→ {",
    '    "kind": "auto", "widget": "CODE_RUBRIC",',
    '    "reasoning": "User-defined rubric, AI grades each PR against it.",',
    '    "source": null, "manual": null,',
    '    "context": { "required": true,',
    '                 "questions": [{ "id": "quality-standards",',
    '                                 "prompt": "What are the team\'s code quality standards?",',
    '                                 "kind": "list",',
    '                                 "placeholder": "e.g. test coverage, naming, docs" }] },',
    '    "delegated": null',
    "  }",
    "",
    'Goal: "Achieve 99.9% client SLA uptime compliance this quarter."',
    "→ Incident-driven reliability goal. Use INCIDENT_LOG so each",
    "  outage is captured as a structured entry, not just a counter:",
    "  {",
    '    "kind": "manual", "widget": "INCIDENT_LOG",',
    '    "reasoning": "Each SLA-affecting outage is logged with severity + ' +
      'downtime. The widget rolls up MTTR and budget consumed.",',
    '    "source": null,',
    '    "manual": { "prompt": "Log this incident: severity, downtime minutes, ' +
      'post-mortem.",',
    '                "cadence": "per-incident", "unit": "minutes",',
    '                "target": { "op": "<=", "value": 43, "period": "quarter" } },',
    '    "context": null, "delegated": null, "untrackable": null',
    "  }",
    "",
    'Goal: "Run quarterly disaster-recovery drills covering every Tier-1 system."',
    "→ Period-resetting checklist. Use RECURRING_MILESTONE so each",
    "  quarter starts fresh and the streak of complete quarters is tracked:",
    "  {",
    '    "kind": "manual", "widget": "RECURRING_MILESTONE",',
    '    "reasoning": "DR drill runs every quarter. Each period has its own ' +
      'checklist of Tier-1 systems; the streak of complete quarters is the headline.",',
    '    "source": null,',
    '    "manual": { "prompt": "Tick each Tier-1 system you drilled this quarter.",',
    '                "cadence": "quarterly",',
    '                "items": ["Database failover", "App stack restore", ' +
      '"DNS cutover", "Backup restore test"] },',
    '    "context": null, "delegated": null, "untrackable": null',
    "  }",
    "",
    'Goal: "Run quarterly DR drills, fully DOCUMENTED: scenario, measured ' +
      'RTO/RPO, findings, and prior action items closed."',
    "→ Needs a structured documented RECORD each quarter (not a yes/no",
    "  checklist) — use COMPOSED with one field per documented thing:",
    "  {",
    '    "kind": "manual", "widget": "COMPOSED",',
    '    "reasoning": "Each quarter must document scenario + measured RTO/RPO ' +
      '+ findings doc + prior actions — a multi-field record graded on evidence.",',
    '    "source": null, "manual": null,',
    '    "fields": [',
    '      { "kind": "checkbox", "label": "Drill executed on schedule" },',
    '      { "kind": "select", "label": "Scenario exercised", "options": ' +
      '["Region loss", "Ransomware", "Provider outage", "Data corruption"] },',
    '      { "kind": "number", "label": "RTO measured", "unit": "min", ' +
      '"target": { "op": "<=", "value": 240 } },',
    '      { "kind": "number", "label": "RPO measured", "unit": "min" },',
    '      { "kind": "link", "label": "Findings / post-mortem doc" },',
    '      { "kind": "checkbox", "label": "Prior action items closed" }',
    "    ],",
    '    "composed": { "cadence": "quarterly", "prompt": "Log this quarter\'s ' +
      'DR drill — execution, measures, and proof." },',
    '    "context": null, "delegated": null, "untrackable": null,',
    '    "tiers": { "notAchieved": "Drill skipped OR run but not documented ' +
      '(scenario, RTO/RPO, findings).",',
    '               "achieved": "Executed + scenario + measured RTO/RPO + ' +
      'findings link + prior actions closed.",',
    '               "overAchieved": "Achieved AND RTO within target AND ' +
      'scenario rotated vs last quarter.",',
    '               "roleModel": "Every quarter fully executed + documented, ' +
      'actions closed, recovery runbooks as code." } }',
    "",
    'Goal: "Improve team morale and psychological safety this quarter."',
    "→ Genuinely doesn't map to a measurable widget. Mark untrackable",
    "  with a best-guess widget so the spec is editable later:",
    "  {",
    '    "kind": "manual", "widget": "SCALE",',
    '    "reasoning": "Best-guess if instrumented, but no obvious metric exists.",',
    '    "source": null, "manual": null, "context": null, "delegated": null,',
    '    "untrackable": { "reason": "No quantitative signal for team morale ' +
      'until a pulse survey or 1:1 ritual is established." }',
    "  }",
  ].join("\n");
}

export const SYSTEM_PROMPT = buildSystemPrompt();

/**
 * Fallback scorecard used when the model picks `widget: "SCORECARD"`
 * but omits / nullifies the `scorecard` block. Without this safety
 * net the validator rejects the whole spec and the user sees "Failed
 * to classify" for any compound goal the model only half-handles —
 * a worse outcome than landing a half-finished SCORECARD that the
 * user finishes in the Review pane.
 *
 * Two bare MERGED_COUNT components with even-split weights. The user
 * picks the right widgets/targets per-row inside the Review pane's
 * ScorecardEditor. Aggregate is "weighted" because that's the only
 * one the MVP validates.
 */
function seedDefaultScorecard() {
  const bare = () => ({
    label: "",
    weight: 50,
    widget: "MERGED_COUNT",
    kind: "auto",
    source: {
      provider: "combined",
      metric: "merged_count",
      window: "30d",
      target: null,
    },
    manual: null,
  });
  return {
    aggregate: "weighted",
    components: [bare(), bare()],
  };
}

/**
 * Fallback fields for a COMPOSED spec the model chose but left without a
 * usable `fields` array. A minimal documented-record schema — what was done
 * plus an evidence link — so the goal lands as a usable (if generic) widget
 * the user can edit or re-analyze, instead of hard-failing validation.
 */
function seedDefaultComposedFields() {
  return [
    { id: "summary", kind: "text", label: "What was done this period" },
    { id: "evidence", kind: "link", label: "Evidence / doc link", optional: true },
  ];
}

export function buildUserPrompt(goal: GoalForClassification): string {
  const lines = [
    `Goal ID: ${goal.id}`,
    `Goal kind: ${goal.kind}`,
    `Title: ${goal.title}`,
  ];
  if (goal.description) lines.push(`Description / rubric: ${goal.description}`);
  if (goal.parentL1Title) lines.push(`Parent L1 goal: ${goal.parentL1Title}`);
  // Phase C: render the user's previously-supplied context answers as
  // bullets BELOW the rubric. Marked "authoritative" so the model
  // prefers these definitions to its own guess for vague terms. When
  // present, the model should usually NOT re-emit a `context.required`
  // block — the user has already answered.
  if (goal.contextAnswers && goal.contextAnswers.length > 0) {
    lines.push("");
    lines.push("User-supplied context (authoritative — use these definitions):");
    for (const { prompt, answer } of goal.contextAnswers) {
      const trimmedPrompt = prompt.trim();
      const trimmedAnswer = answer.trim();
      if (!trimmedPrompt || !trimmedAnswer) continue;
      lines.push(`  • ${trimmedPrompt}`);
      // Indent multi-line answers two extra spaces so the bullet
      // structure stays readable when the user pasted a list or rubric.
      for (const ln of trimmedAnswer.split(/\r?\n/)) {
        lines.push(`      ${ln}`);
      }
    }
  }
  lines.push("", "Classify this goal. Respond with a single JSON object.");
  return lines.join("\n");
}

// ─── single-goal streaming call ──────────────────────────────────────

interface PerCallOpts {
  apiKey: string;
  url: string;
  model: string;
  label: string;
  extraHeaders: Record<string, string>;
  signal?: AbortSignal;
}

async function* classifyOneGoal(
  goal: GoalForClassification,
  opts: PerCallOpts,
): AsyncGenerator<AnalysisEvent, void, unknown> {
  yield AnalysisEvents.goalStarted({
    goalId: goal.id,
    title: goal.title,
    parentL1: goal.parentL1Title,
  });

  // Prefer JSON-Schema response_format mode — locks every enum the
  // catalogue advertises (provider, metric, window, cadence, etc.)
  // so the model can't return hallucinated values like
  // `uptime_compliance` for source.metric. The fallback below handles
  // providers that don't support `json_schema` (older OpenRouter-routed
  // models, GLM in certain modes) by retrying with the older
  // `json_object` mode + an explicit error from the upstream provider.
  const baseBody = {
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(goal) },
    ],
    temperature: 0.2,
    stream: true,
  } as const;

  const buildBody = (responseFormat: unknown) => ({
    ...baseBody,
    response_format: responseFormat,
  });

  // Bounded retry on model-tier rate limits: a 429 mid-classification
  // shouldn't fail the goal outright. We wait the upstream-indicated
  // delay and retry within the streaming function's budget; goals that
  // still fail after that can be re-run individually from the Review
  // pane (reclassifyOneGoal).
  const requestWithFormat = async (
    responseFormat: unknown,
  ): Promise<Awaited<ReturnType<typeof fetch>>> =>
    fetchWithRateLimitRetry(
      () =>
        fetch(opts.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...opts.extraHeaders,
          },
          body: JSON.stringify(buildBody(responseFormat)),
          signal: opts.signal,
        }),
      {
        maxAttempts: 4,
        maxTotalWaitMs: 20_000,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    );

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await requestWithFormat({
      type: "json_schema",
      json_schema: SPEC_RESPONSE_SCHEMA,
    });
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // If the provider rejects json_schema (some return 400 with a
  // "response_format type must be ..." error, others ignore it
  // silently — we only retry on the explicit 400), fall back to the
  // older json_object mode. The prompt-side enum reminders still keep
  // the model honest, just without the provider-side schema lock.
  if (res.status === 400) {
    const errText = await res.clone().text().catch(() => "");
    const looksLikeSchemaUnsupported =
      /response_format/i.test(errText) ||
      /json[_-]?schema/i.test(errText) ||
      /unsupported/i.test(errText);
    if (looksLikeSchemaUnsupported) {
      try {
        res = await requestWithFormat({ type: "json_object" });
      } catch (err) {
        yield AnalysisEvents.goalFailed({
          goalId: goal.id,
          error: `Network error on json_object fallback: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        return;
      }
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `${opts.label} ${res.status}: ${errText.slice(0, 300)}`,
    });
    return;
  }
  if (!res.body) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `${opts.label}: empty response stream`,
    });
    return;
  }

  // OpenAI-format SSE: `data: {json}\n\n`, terminated by `data: [DONE]`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let jsonBuffer = "";

  try {
    while (true) {
      if (opts.signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep last (possibly partial) line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: { choices?: Array<{ delta?: { content?: string } }> };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          jsonBuffer += delta;
          yield AnalysisEvents.goalReasoning({
            goalId: goal.id,
            chunk: delta,
          });
        }
      }
    }
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  yield specEventFromBuffer(goal, jsonBuffer);
}

/**
 * Turn a model's raw JSON-buffer output into a terminal AnalysisEvent —
 * GOAL_CLASSIFIED on a valid spec, GOAL_FAILED otherwise. Shared by the
 * OpenAI-compatible streamer above AND the native Anthropic classifier
 * (anthropic.ts), so the parse → candidate → validate → emit logic has
 * exactly one home. Defensive about stray prose/markdown fences around
 * the JSON, which non-JSON-mode models (Anthropic) can wrap it in.
 */
export function specEventFromBuffer(
  goal: GoalForClassification,
  jsonBuffer: string,
): AnalysisEvent {
  let parsedSpec: unknown;
  try {
    parsedSpec = JSON.parse(extractJsonObject(jsonBuffer));
  } catch (err) {
    return AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Invalid JSON from classifier: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // The model returns the spec body without the goalId/title — caller
  // attaches them so the spec is self-describing.
  const obj = (parsedSpec as Record<string, unknown>) ?? {};
  const candidate: Record<string, unknown> = {
    goalId: goal.id,
    title: goal.title,
    kind: obj.kind,
    widget: obj.widget,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    source: obj.source ?? null,
    manual: obj.manual ?? null,
    context: obj.context ?? null,
    delegated: obj.delegated ?? null,
    untrackable: obj.untrackable ?? null,
    scorecard: obj.scorecard ?? null,
    // COMPOSED owns its data through fields[] + the cadence/prompt frame —
    // forward both so a COMPOSED spec the model emits actually validates.
    fields: obj.fields ?? null,
    composed: obj.composed ?? null,
    tiers: obj.tiers ?? null,
    // W1: numeric ladder for deterministic grading (null for qualitative).
    tierScale: obj.tierScale ?? null,
    firstReviewOnly: obj.firstReviewOnly === true,
    classifiedAt: Date.now(),
  };
  if (candidate.widget === "SCORECARD") {
    if (!candidate.scorecard) {
      candidate.scorecard = seedDefaultScorecard();
      candidate.kind = "auto"; // 2 auto-seeded components → auto.
    } else {
      // `kind` is DERIVED from the components — "auto" when every component is
      // AUTO, "hybrid" when any is MANUAL. The model sometimes emits a kind
      // that contradicts its own components (e.g. "hybrid" with only AUTO
      // components), which validateSpec then rejects, failing the whole goal's
      // (re)classification. Recompute kind from the components rather than
      // trust the model's label.
      const sc = candidate.scorecard as any;
      const comps: any[] = Array.isArray(sc.components) ? sc.components : [];
      const anyManual = comps.some((c) => c && c.kind === "manual");
      candidate.kind = anyManual ? "hybrid" : "auto";
    }
    // SCORECARD owns its data through components; top-level source/manual are
    // always null on a clean spec.
    candidate.source = null;
    candidate.manual = null;
  }
  // COMPOSED safety net: the model picked the generative widget but didn't
  // emit a usable `fields` array. Rather than hard-fail the whole goal, seed
  // a minimal documented-record schema the user can flesh out / re-analyze —
  // same spirit as the SCORECARD fallback above.
  if (
    candidate.widget === "COMPOSED" &&
    !(Array.isArray(candidate.fields) && candidate.fields.length > 0)
  ) {
    candidate.fields = seedDefaultComposedFields();
    candidate.source = null;
    candidate.manual = null;
    candidate.kind = "manual";
  }
  const result = validateSpec(candidate);
  if (!result.ok) {
    return AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Spec failed validation: ${result.errors.join("; ")}`,
    });
  }
  return AnalysisEvents.goalClassified({ goalId: goal.id, spec: result.spec });
}

/**
 * Pull the JSON object out of a model response. JSON-mode providers
 * return clean JSON; others may wrap it in ```json fences or a sentence.
 * We slice from the first `{` to the last `}` — good enough for the
 * single-object specs the classifier emits.
 */
function extractJsonObject(raw: string): string {
  const s = raw.trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return s;
  return s.slice(first, last + 1);
}

// ─── factory ─────────────────────────────────────────────────────────

/**
 * Build a classifier port. The returned object has `classify(goals, opts)`
 * which yields AnalysisEvents.
 *
 * Concurrency model:
 *   - Up to `concurrency` per-goal iterators run at once
 *   - We race their pending `next()` promises and yield whichever
 *     resolves first; this interleaves events across goals so the UI
 *     streams per-goal progress in real time
 *   - When an iterator finishes, we start the next queued goal
 *   - On `signal.aborted`, we stop pulling and emit COMPLETE with the
 *     partial count
 */
export function createMistralClassifier(
  config: ClassifierConfig,
): ClassifierPort {
  if (!config.apiKey) {
    throw new Error("createMistralClassifier: `apiKey` is required");
  }
  const url = config.url;
  const model = config.model;
  const label = config.label;
  const extraHeaders = config.extraHeaders ?? {};
  const concurrency = Math.max(
    1,
    Math.min(10, config.concurrency ?? 3),
  );

  return {
    async *classify(
      goals: GoalForClassification[],
      options: ClassifyOptions = {},
    ): AsyncGenerator<AnalysisEvent, void, unknown> {
      const startedAt = Date.now();
      yield AnalysisEvents.start({
        totalGoals: goals.length,
        startedAt,
      });

      if (goals.length === 0) {
        yield AnalysisEvents.complete({ count: 0, elapsedMs: 0 });
        return;
      }

      const queue = [...goals];
      let completedCount = 0;
      type RunningIter = AsyncGenerator<AnalysisEvent, void, unknown>;
      const runningIters = new Set<RunningIter>();
      const runningReaders = new Map<
        RunningIter,
        { next: Promise<IteratorResult<AnalysisEvent>> }
      >();

      const startOne = (): boolean => {
        const goal = queue.shift();
        if (!goal) return false;
        const iter = classifyOneGoal(goal, {
          apiKey: config.apiKey,
          url,
          model,
          label,
          extraHeaders,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        runningIters.add(iter);
        runningReaders.set(iter, { next: iter.next() });
        return true;
      };

      // Prime up to `concurrency` iterators.
      for (let i = 0; i < concurrency; i += 1) {
        if (!startOne()) break;
      }

      while (runningIters.size > 0) {
        if (options.signal?.aborted) break;

        // Race whichever reader resolves next.
        const winner = await Promise.race(
          [...runningIters].map((iter) => {
            const reader = runningReaders.get(iter);
            if (!reader) {
              return Promise.reject(new Error("classifier: missing reader"));
            }
            return reader.next.then((res) => ({ iter, res }));
          }),
        );
        const { iter, res } = winner;
        if (res.done) {
          runningIters.delete(iter);
          runningReaders.delete(iter);
          completedCount += 1;
          startOne();
          continue;
        }
        yield res.value;
        const reader = runningReaders.get(iter);
        if (reader) {
          reader.next = iter.next();
        }
      }

      yield AnalysisEvents.complete({
        count: completedCount,
        elapsedMs: Date.now() - startedAt,
      });
    },
  };
}
