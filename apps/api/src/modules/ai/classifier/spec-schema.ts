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
          "CODE_RUBRIC",
          "COUNTER",
          "SCALE",
          "MILESTONE",
          "DATE_LOG",
          "FREE_TEXT",
          "BEFORE_AFTER",
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
        required: ["provider", "metric", "window", "target"],
        properties: {
          provider: {
            type: "string",
            enum: ["github", "gitlab", "jira", "combined"],
          },
          metric: {
            type: "string",
            enum: [
              "merged_count",
              "avg_rounds",
              "median_turnaround",
              "linkage_pct",
              "ticket_cycle_time",
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
    },
  },
} as const;
