/**
 * JSON Schema for the classifier's response, passed to OpenAI-compatible
 * providers via `response_format.json_schema`. Locks down every enum
 * the system prompt advertises so the model literally cannot emit a
 * value outside the catalogue (no more hallucinated metrics like
 * `uptime_compliance` or invented kinds like `goal-tracker`).
 *
 * What this enforces vs. the prompt:
 *
 *   The PROMPT explains widget→kind pairing, widget→metric pairing, and
 *   semantic guidance for each metric. JSON Schema can't easily express
 *   conditional "if widget is X then kind must be Y" rules without
 *   making the schema unmanageable (and some providers' strict-mode
 *   implementations choke on complex `if/then/else`). So:
 *
 *     - Enums are enforced by the schema (provider-side) — the model
 *       literally can't return an unknown value
 *     - Structural rules (widget↔kind, widget↔metric pairing) are
 *       enforced by the prompt + by validateSpec() server-side
 *
 *   The two layers together close the gap: prompt drives intent, schema
 *   enforces vocabulary, validator catches anything that slips through.
 *
 * Why STRICT mode (`strict: true`):
 *
 *   Strict requires every property listed in `properties` to also be
 *   in `required`. Optional fields become required-as-nullable using
 *   `["type", "null"]` unions. This shape is what OpenAI / Mistral /
 *   GLM / OpenRouter agree on. The model emits explicit `null` for
 *   sections that don't apply — slightly more verbose JSON but
 *   completely unambiguous and friendly to dumb parsers.
 */

export const SPEC_RESPONSE_SCHEMA = {
  name: "goal_spec",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "kind",
      "widget",
      "reasoning",
      "source",
      "manual",
      "context",
      "delegated",
      "untrackable",
      "scorecard",
      "firstReviewOnly",
      "tiers",
    ],
    properties: {
      kind: {
        type: "string",
        enum: ["auto", "manual", "hybrid"],
        description:
          "Spec variant — must match the chosen widget's canonical kind " +
          "(see system prompt).",
      },
      widget: {
        type: "string",
        enum: [
          "MERGED_COUNT",
          "REVIEW_ROUNDS",
          "TURNAROUND",
          "LINKAGE",
          "TICKET_CYCLE",
          "FIRST_PASS_RATE",
          "DEPLOY_FREQUENCY",
          "LEAD_TIME",
          "BUILD_PASS_RATE",
          "CODE_RUBRIC",
          "COUNTER",
          "SCALE",
          "MILESTONE",
          "DATE_LOG",
          "FREE_TEXT",
          "BEFORE_AFTER",
          "INCIDENT_LOG",
          "RECURRING_MILESTONE",
          "SCORECARD",
        ],
        description: "Widget kind from the catalogue.",
      },
      reasoning: {
        type: "string",
        description: "1-2 sentence explanation shown to the user.",
      },
      source: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["provider", "metric", "window", "target", "filter"],
        properties: {
          provider: {
            type: "string",
            enum: [
              "github",
              "gitlab",
              "jira",
              "combined",
              "jenkins",
              "github_actions",
            ],
          },
          metric: {
            type: "string",
            enum: [
              "merged_count",
              "avg_rounds",
              "median_turnaround",
              "linkage_pct",
              "ticket_cycle_time",
              "first_pass_rate",
              "deploy_frequency",
              "lead_time",
              "build_pass_rate",
            ],
          },
          window: {
            type: "string",
            enum: ["30d", "90d", "quarter"],
          },
          target: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["op", "value"],
            properties: {
              op: { type: "string", enum: ["<=", ">=", "="] },
              value: { type: "number" },
            },
          },
          filter: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["repo", "job"],
            properties: {
              repo: {
                type: ["string", "null"],
                description:
                  "Optional GitHub/GitLab repo slug ('owner/name' or " +
                  "'group/project'). Reused by `github_actions` provider " +
                  "to scope workflow runs to one repo. Leave null to " +
                  "count across every connected repo (the default). " +
                  "The user can set this in the Review pane after " +
                  "classification — the AI should default to null here.",
              },
              job: {
                type: ["string", "null"],
                description:
                  "Jenkins job slug. Required for `jenkins` provider " +
                  "(Jenkins has no cross-job feed). Leave null for any " +
                  "other provider — the user picks the job in the " +
                  "Review pane after classification.",
              },
            },
          },
        },
        description:
          "Required for AUTO widgets that read integration data " +
          "(MERGED_COUNT, REVIEW_ROUNDS, TURNAROUND, LINKAGE, " +
          "TICKET_CYCLE). MUST be null for CODE_RUBRIC and MANUAL widgets.",
      },
      manual: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["prompt", "cadence", "unit", "items", "target"],
        properties: {
          prompt: { type: "string" },
          cadence: {
            type: "string",
            enum: [
              "daily",
              "weekly",
              "biweekly",
              "monthly",
              "quarterly",
              "per-incident",
              "milestone",
              "continuous",
            ],
          },
          unit: { type: ["string", "null"] },
          items: {
            type: ["array", "null"],
            items: { type: "string" },
          },
          target: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["op", "value", "period"],
            properties: {
              op: { type: "string", enum: ["<=", ">=", "="] },
              value: { type: "number" },
              period: { type: ["string", "null"] },
            },
          },
        },
        description:
          "Required for MANUAL widgets and the manual half of HYBRID. " +
          "MUST be null for pure AUTO widgets.",
      },
      context: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["required", "questions"],
        properties: {
          required: { type: "boolean" },
          questions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "prompt", "kind", "placeholder", "options"],
              properties: {
                id: { type: "string" },
                prompt: { type: "string" },
                kind: {
                  type: "string",
                  enum: ["text", "list", "number", "select"],
                },
                placeholder: { type: ["string", "null"] },
                options: {
                  type: ["array", "null"],
                  items: { type: "string" },
                },
              },
            },
          },
        },
        description:
          "Optional user-supplied context. Required for CODE_RUBRIC " +
          "(must contain a question with id 'quality-standards'). " +
          "Otherwise null unless tracking is meaningless without an " +
          "answer.",
      },
      delegated: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["delegated", "judge", "note"],
        properties: {
          delegated: { type: "boolean" },
          judge: {
            type: "string",
            enum: ["manager", "senior", "peer"],
          },
          note: { type: "string" },
        },
        description:
          "Set when the goal is evaluated by a human judge. Even when " +
          "delegated, source/manual should still be set so the user can " +
          "opt into self-tracking.",
      },
      untrackable: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["reason"],
        properties: {
          reason: { type: "string" },
        },
        description:
          "Set when the goal genuinely doesn't map to any widget in the " +
          "catalogue right now — the needed integration isn't connected, " +
          "the goal is too vague to instrument, or judgement is needed " +
          "before tracking starts. The `reason` is shown to the user as " +
          "the explanation. Still pick a best-guess widget so the spec " +
          "stays editable; when the user unflags untrackable later, the " +
          "widget choice resurfaces as a starting point.",
      },
      firstReviewOnly: {
        type: ["boolean", "null"],
        description:
          "When true on a CODE_RUBRIC spec, the grader filters PR " +
          "comments to the FIRST review round only (everything up to " +
          "and including the first reviewer comment). Lets the rubric " +
          "judge code quality at first review, before iterative " +
          "fixes mask the original state. Ignored for non-CODE_RUBRIC " +
          "widgets.",
      },
      scorecard: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["components", "aggregate"],
        properties: {
          aggregate: {
            type: "string",
            enum: ["weighted"],
            description:
              "Currently always 'weighted' — each component contributes " +
              "weight × its 0-100 score, normalised by Σweights.",
          },
          components: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "label",
                "weight",
                "widget",
                "kind",
                "source",
                "manual",
                "firstReviewOnly",
              ],
              properties: {
                label: { type: ["string", "null"] },
                weight: { type: "number" },
                firstReviewOnly: {
                  type: ["boolean", "null"],
                  description:
                    "Mirror of the top-level field — only meaningful " +
                    "on a CODE_RUBRIC component.",
                },
                widget: {
                  type: "string",
                  enum: [
                    "MERGED_COUNT",
                    "REVIEW_ROUNDS",
                    "TURNAROUND",
                    "LINKAGE",
                    "TICKET_CYCLE",
                    "FIRST_PASS_RATE",
                    "DEPLOY_FREQUENCY",
                    "LEAD_TIME",
                    "BUILD_PASS_RATE",
                    "CODE_RUBRIC",
                    "COUNTER",
                    "SCALE",
                    "MILESTONE",
                    "DATE_LOG",
                    "FREE_TEXT",
                    "BEFORE_AFTER",
                    "INCIDENT_LOG",
                    "RECURRING_MILESTONE",
                  ],
                },
                kind: {
                  type: "string",
                  enum: ["auto", "manual", "hybrid"],
                },
                // The component's source / manual mirror the top-level
                // shapes one level down — we reuse the same object
                // schemas by reference rather than re-stating every
                // enum, which keeps the strict-mode schema readable.
                source: { type: ["object", "null"] },
                manual: { type: ["object", "null"] },
              },
            },
          },
        },
        description:
          "REQUIRED when widget is SCORECARD; MUST be null otherwise. " +
          "Hosts 2-3 component sub-specs whose individual scores are " +
          "weighted-averaged into the tile's headline. Each component " +
          "is itself a (widget, kind, source, manual) tuple — its " +
          "validation runs server-side via the shared validator.",
      },
      tiers: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["notAchieved", "achieved", "overAchieved", "roleModel"],
        properties: {
          notAchieved: { type: ["string", "null"] },
          achieved: { type: ["string", "null"] },
          overAchieved: { type: ["string", "null"] },
          roleModel: { type: ["string", "null"] },
        },
        description:
          "The four achievement levels an AI grader later scores this " +
          "goal against. Distil them from the goal's rubric/description, " +
          "and make each MEASURABLE against the chosen widget's metric " +
          "where one exists (e.g. for MERGED_COUNT target >=8: " +
          "notAchieved '<8 merged', achieved '>=8 merged', overAchieved " +
          "'>=12 merged', roleModel '>=16 merged with zero reverts'). " +
          "If the rubric already states tiers, normalise them into this " +
          "shape and keep the user's thresholds. Keep each <=160 chars. " +
          "Use null for a tier you genuinely can't express; null the " +
          "whole object only for goals with no meaningful levels.",
      },
    },
  },
} as const;
