/**
 * The single zod entry for a "Submit for review" body.
 *
 * v1 (no `version`, or `version: 1`): the frozen markdown + narrative +
 * flat goal rows the web sent before HTML packets.
 *
 * v2 (`version: 2`): a template name + a structured `payload` the web
 * templates render. The flat `goals` rows every v1 reader uses (manager
 * list, goal health) are DERIVED here from the payload, so those readers
 * keep working unchanged. `level` / `rangeLabel` mirror payload fields
 * for the same reason.
 */

import { z } from "zod";
import type {
  PacketTemplate,
  ReviewPacketGoalRow,
  ReviewPacketPayload,
} from "../../db/types.js";

/** Whole-payload cap, measured as serialised JSON length. */
export const MAX_PAYLOAD_CHARS = 400_000;
/** The Mongo validator's cap on flat goal rows. */
const MAX_GOAL_ROWS = 500;

const PACKET_TEMPLATES = ["scorecard", "journey", "deck", "dossier"] as const satisfies readonly PacketTemplate[];

// ─── v1 ──────────────────────────────────────────────────────────────

const goalRowSchema = z.object({
  goalId: z.string().min(1).max(200),
  title: z.string().max(1_000).default(""),
  l1Title: z.string().max(1_000).default(""),
  tier: z.string().max(50).nullable().default(null),
  reading: z.string().max(500).nullable().default(null),
  statusLabel: z.string().max(100).nullable().default(null),
});

const v1Schema = z.object({
  version: z.literal(1),
  level: z.string().max(100).default(""),
  rangeLabel: z.string().max(200).default(""),
  narrative: z.string().max(20_000).default(""),
  markdown: z.string().min(1).max(400_000),
  goals: z.array(goalRowSchema).max(MAX_GOAL_ROWS).default([]),
  starredCount: z.number().int().min(0).max(10_000).default(0),
});

// ─── v2 payload ──────────────────────────────────────────────────────

const id = z.string().min(1).max(200);
const title = z.string().max(1_000);
const text = z.string().max(4_000);
const optText = text.nullable().optional();
const tier = z.enum(["not_achieved", "achieved", "over_achieved", "role_model"]);
const count = z.number().int().min(0).max(1_000_000);

const ladder = z.object({
  notAchieved: text.nullable(),
  achieved: text.nullable(),
  overAchieved: text.nullable(),
  roleModel: text.nullable(),
});

const packetGoal = z.object({
  id,
  title,
  kind: z.string().max(100),
  cadence: z.string().max(100).nullable().optional(),
  target: z.union([z.string().max(1_000), z.number()]).nullable().optional(),
  reading: optText,
  statusLabel: optText,
  statusReason: optText,
  tiers: ladder.nullable().optional(),
  cadenceTiers: ladder.nullable().optional(),
  verdict: z
    .object({
      tier,
      reasoning: text,
      lowConfidence: z.boolean(),
      gradedAt: z.string().max(100).nullable(),
    })
    .nullable()
    .optional(),
  managerVerdict: z
    .object({
      tier,
      note: text.nullable(),
      gradedAt: z.string().max(100).nullable(),
    })
    .nullable()
    .optional(),
  windows: z
    .array(
      z.object({
        key: z.string().max(200),
        label: z.string().max(200),
        state: z.string().max(30),
        verdict: tier.nullable().optional(),
      }),
    )
    .max(60)
    .default([]),
  evidence: z
    .array(
      z.object({
        at: z.string().max(100),
        text,
        link: z.string().max(2_000).nullable().optional(),
      }),
    )
    .max(200)
    .default([]),
});

const payloadSchema = z
  .object({
    range: z.object({
      label: z.string().max(200),
      start: z.string().max(100).nullable(),
      end: z.string().max(100).nullable(),
    }),
    cycleKey: z.string().max(200).nullable(),
    submitter: z.object({
      displayName: title.nullable(),
      level: z.string().max(100).nullable(),
      department: title.nullable(),
    }),
    objectives: z
      .array(
        z.object({
          id,
          title,
          weight: z.number().nullable(),
          reading: optText,
          goals: z.array(packetGoal).max(MAX_GOAL_ROWS),
        }),
      )
      .max(200),
    untracked: z.array(z.object({ id, title, l1Title: title })).max(MAX_GOAL_ROWS),
    totals: z.object({
      goals: count,
      tracked: count,
      byTier: z.object({
        notAchieved: count,
        achieved: count,
        overAchieved: count,
        roleModel: count,
      }),
    }),
  })
  .superRefine((p, ctx) => {
    const rows = p.objectives.reduce((n, o) => n + o.goals.length, 0) + p.untracked.length;
    if (rows > MAX_GOAL_ROWS) {
      ctx.addIssue({
        code: "custom",
        message: `A packet holds at most ${MAX_GOAL_ROWS} goals (got ${rows}).`,
        path: ["objectives"],
      });
    }
    if (JSON.stringify(p).length > MAX_PAYLOAD_CHARS) {
      ctx.addIssue({
        code: "custom",
        message: `The packet is too large (over ${MAX_PAYLOAD_CHARS} characters).`,
      });
    }
  });

const v2Schema = z.object({
  version: z.literal(2),
  template: z.enum(PACKET_TEMPLATES),
  payload: payloadSchema,
  markdown: z.string().min(1).max(400_000).optional(),
});

const bodySchema = z.preprocess(
  (body) =>
    body && typeof body === "object" && !Array.isArray(body) && (body as { version?: unknown }).version === undefined
      ? { ...body, version: 1 }
      : body,
  z.discriminatedUnion("version", [v1Schema, v2Schema]),
);

// ─── derivation ──────────────────────────────────────────────────────

const clip = (s: string | null | undefined, max: number): string | null =>
  s == null ? null : s.slice(0, max);

/** Flatten objectives → goal rows, then untracked goals. The row's tier
 *  is the DISPLAYED one: a manager verdict outranks the AI's. */
export function deriveGoalRows(payload: ReviewPacketPayload): ReviewPacketGoalRow[] {
  const rows: ReviewPacketGoalRow[] = [];
  for (const o of payload.objectives) {
    for (const g of o.goals) {
      rows.push({
        goalId: g.id,
        title: g.title,
        l1Title: o.title,
        tier: g.managerVerdict?.tier ?? g.verdict?.tier ?? null,
        reading: clip(g.reading, 500),
        statusLabel: clip(g.statusLabel, 100),
      });
    }
  }
  for (const u of payload.untracked) {
    rows.push({
      goalId: u.id,
      title: u.title,
      l1Title: u.l1Title,
      tier: null,
      reading: null,
      statusLabel: "No tracker yet",
    });
  }
  return rows;
}

// ─── entry ───────────────────────────────────────────────────────────

export type PacketBodyV1 = z.infer<typeof v1Schema>;

export interface PacketBodyV2 {
  version: 2;
  template: PacketTemplate;
  payload: ReviewPacketPayload;
  goals: ReviewPacketGoalRow[];
  goalCount: number;
  level: string;
  rangeLabel: string;
  markdown?: string;
}

export type PacketBody = PacketBodyV1 | PacketBodyV2;

/** Parse a submit body. Throws `ZodError` on anything invalid,
 *  including a v2 payload over {@link MAX_PAYLOAD_CHARS}. */
export function parsePacketBody(body: unknown): PacketBody {
  const parsed = bodySchema.parse(body);
  if (parsed.version === 1) return parsed;
  const payload: ReviewPacketPayload = parsed.payload;
  const goals = deriveGoalRows(payload);
  return {
    version: 2,
    template: parsed.template,
    payload,
    goals,
    goalCount: goals.length,
    level: payload.submitter.level ?? "",
    rangeLabel: payload.range.label,
    ...(parsed.markdown ? { markdown: parsed.markdown } : {}),
  };
}
