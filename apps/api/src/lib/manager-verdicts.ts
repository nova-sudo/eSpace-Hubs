/**
 * Manager goal-verdict data access. The durable, authoritative tier a
 * manager sets on a report's goal — outranks the AI cache everywhere a
 * tier is shown.
 *
 * Two collections:
 *
 *   manager_goal_verdicts        the CURRENT grade per (org, subject, goal).
 *                                Every existing reader (dev badge, manager
 *                                board, shared goals, cycle archive) reads
 *                                this, so their behaviour is unchanged.
 *   manager_goal_verdict_events  the append-only history, keyed by
 *                                (org, subject, goal, periodKey). A re-grade
 *                                in the same period stamps `supersededAt` on
 *                                the previous row — nothing is overwritten.
 *
 * periodKey is the grading period: the calendar year of the grade ("2026")
 * unless the grading UI supplies a finer key ("2026-Q1"). Legacy current
 * rows (written before history existed) carry no periodKey and read as the
 * year of their `gradedAt`; the first write or acknowledgement on such a
 * goal backfills one `legacy: true` event from the row, so history never
 * starts from a hole.
 *
 * Shared by the manager module (write + board read) and the dev-facing
 * `/goal-verdicts/mine` reads, so the "manager wins" precedence has a
 * single source of truth.
 */

import { ObjectId, type Collection } from "mongodb";
import {
  getManagerGoalVerdictEventsCollection,
  getManagerGoalVerdictsCollection,
} from "../db/collections.js";
import type {
  GoalTier,
  ManagerGoalVerdict,
  ManagerGoalVerdictEvent,
  ManagerVerdictAck,
} from "../db/types.js";

// ─── pure helpers (unit-tested) ──────────────────────────────────────

/**
 * The grading-period formats: a year ("2026"), a quarter ("2026-Q1"), a
 * half ("2026-H2") or a month ("2026-03"). Anything else is rejected.
 */
const PERIOD_KEY_RE = /^(\d{4})(?:-(Q[1-4]|H[12]|0[1-9]|1[0-2]))?$/;

/** Is `raw` a well-formed grading-period key ("2026", "2026-Q1", …)? */
export function isValidPeriodKey(raw: unknown): raw is string {
  return typeof raw === "string" && PERIOD_KEY_RE.test(raw);
}

/** How far from the current year a WRITTEN period key may be. */
export const PERIOD_YEAR_WINDOW = 2;

/**
 * May a grade be written under `raw`? Well-formed AND within the current
 * UTC year ± PERIOD_YEAR_WINDOW — a far-future key ("2099") would otherwise
 * pin the current badge forever (every later normal grade sorts before it).
 */
export function isAcceptablePeriodKey(raw: unknown, now: Date = new Date()): raw is string {
  if (!isValidPeriodKey(raw)) return false;
  const year = Number(raw.slice(0, 4));
  return Math.abs(year - now.getUTCFullYear()) <= PERIOD_YEAR_WINDOW;
}

/**
 * A period's position in time: (year, month its window ENDS). A year ends
 * in month 12, "Qn" in 3n, "Hn" in 6n, "MM" in MM — so an annual grade
 * sorts after every sub-period of the same year, and a later quarter after
 * an earlier one. Malformed keys sort first.
 */
export function periodOrdinal(key: string): number {
  const m = PERIOD_KEY_RE.exec(key);
  if (!m) return -1;
  const year = Number(m[1]);
  const part = m[2];
  let endMonth = 12;
  if (part?.startsWith("Q")) endMonth = 3 * Number(part.slice(1));
  else if (part?.startsWith("H")) endMonth = 6 * Number(part.slice(1));
  else if (part) endMonth = Number(part);
  return year * 100 + endMonth;
}

/** The default period of a grade set at `at`: its UTC calendar year. */
export function defaultPeriodKey(at: Date): string {
  return String(at.getUTCFullYear());
}

/** A row's period — its own key, else (legacy) the year it was graded. */
export function verdictPeriodKey(
  row: Pick<ManagerGoalVerdict, "periodKey" | "gradedAt">,
): string {
  return isValidPeriodKey(row.periodKey)
    ? row.periodKey
    : defaultPeriodKey(row.gradedAt);
}

/**
 * Should a grade for `incoming` replace the current projection whose
 * period is `current`? Yes unless the current grade is for a strictly
 * LATER period — back-filling last year's grade must not clobber this
 * year's badge. Same period, or a later one, always wins ("latest wins").
 */
export function shouldReplaceCurrent(
  current: string | null,
  incoming: string,
): boolean {
  if (!current) return true;
  return periodOrdinal(incoming) >= periodOrdinal(current);
}

/** The legacy event a pre-history current row stands for. */
export function legacyEventFrom(
  row: ManagerGoalVerdict,
): Omit<ManagerGoalVerdictEvent, "_id"> {
  return {
    orgId: row.orgId,
    subjectUserId: row.subjectUserId,
    goalId: row.goalId,
    periodKey: verdictPeriodKey(row),
    tier: row.tier,
    note: row.note ?? "",
    gradedBy: row.gradedBy,
    gradedByName: row.gradedByName,
    gradedAt: row.gradedAt,
    supersededAt: null,
    legacy: true,
    ack: row.ack ?? null,
  };
}

/** One history row as the API ships it. */
export interface VerdictHistoryItem {
  id: string | null;
  periodKey: string;
  tier: GoalTier;
  note: string;
  gradedByName: string;
  gradedAt: string;
  supersededAt: string | null;
  /** The tier this grade replaced in the same period, if any. */
  previousTier: GoalTier | null;
  legacy: boolean;
  ack: { at: string; disagree: boolean; note: string } | null;
}

export function ackToJson(
  ack: ManagerVerdictAck | null | undefined,
): VerdictHistoryItem["ack"] {
  return ack
    ? { at: ack.at.toISOString(), disagree: ack.disagree, note: ack.note }
    : null;
}

/**
 * The history of one goal, oldest first, with `previousTier` filled from
 * the prior grade in the same period. When there are no events yet but a
 * legacy current row exists, that row is the (single) history entry.
 */
export function buildVerdictHistory(
  events: readonly (Omit<ManagerGoalVerdictEvent, "_id"> & { _id?: ObjectId })[],
  current: ManagerGoalVerdict | null,
): VerdictHistoryItem[] {
  const rows =
    events.length > 0
      ? [...events]
      : current
        ? [{ ...legacyEventFrom(current), _id: undefined }]
        : [];
  rows.sort((a, b) => a.gradedAt.getTime() - b.gradedAt.getTime());
  const lastTierByPeriod = new Map<string, GoalTier>();
  return rows.map((e) => {
    const previousTier = lastTierByPeriod.get(e.periodKey) ?? null;
    lastTierByPeriod.set(e.periodKey, e.tier);
    return {
      id: e._id ? e._id.toHexString() : null,
      periodKey: e.periodKey,
      tier: e.tier,
      note: e.note,
      gradedByName: e.gradedByName,
      gradedAt: e.gradedAt.toISOString(),
      supersededAt: e.supersededAt ? e.supersededAt.toISOString() : null,
      previousTier,
      legacy: e.legacy,
      ack: ackToJson(e.ack),
    };
  });
}

/**
 * Latest grade per (goal, period) out of a set of events — the "latest
 * wins" read for a caller that asks about one specific period.
 */
export function latestPerGoalPerPeriod<
  T extends Pick<ManagerGoalVerdictEvent, "goalId" | "periodKey" | "gradedAt">,
>(events: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const e of events) {
    const key = `${e.goalId}\u0000${e.periodKey}`;
    const prev = out.get(key);
    if (!prev || e.gradedAt.getTime() >= prev.gradedAt.getTime()) out.set(key, e);
  }
  return out;
}

// ─── data access ─────────────────────────────────────────────────────

/** Injectable collections — defaults to the real ones; tests pass fakes. */
export interface VerdictCollections {
  current: Collection<ManagerGoalVerdict>;
  events: Collection<ManagerGoalVerdictEvent>;
}

async function defaultCollections(): Promise<VerdictCollections> {
  const [current, events] = await Promise.all([
    getManagerGoalVerdictsCollection(),
    getManagerGoalVerdictEventsCollection(),
  ]);
  return { current, events };
}

export interface RecordManagerVerdictInput {
  orgId: ObjectId;
  subjectUserId: ObjectId;
  goalId: string;
  tier: GoalTier;
  note: string;
  gradedBy: ObjectId;
  gradedByName: string;
  /** Grading period; defaults to the current calendar year. */
  periodKey?: string | null;
  /** Injectable clock (tests). */
  now?: Date;
}

/** The before/after of one grade write — what the audit row carries. */
export interface RecordManagerVerdictResult {
  periodKey: string;
  eventId: ObjectId;
  /** The previous grade for the SAME period, or null for a first grade. */
  before: { tier: GoalTier; note: string; gradedByName: string; gradedAt: Date } | null;
  /** Whether the current-grade projection now shows this grade. */
  current: boolean;
  /**
   * The same tier + note as the active grade for this period — nothing was
   * written: no new event, the report's acknowledgement is kept, and the
   * caller should neither notify nor audit a change.
   */
  unchanged: boolean;
}

/** Mongo's duplicate-key error (a unique index rejected the write). */
export function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 11000;
}

/**
 * Backfill the one legacy event a pre-history current row stands for, so
 * its grade isn't lost from history the first time the goal is touched.
 * No-op once any event exists for the goal.
 */
async function ensureLegacyEvent(
  cols: VerdictCollections,
  row: ManagerGoalVerdict | null,
): Promise<ObjectId | null> {
  if (!row) return null;
  const any = await cols.events.findOne({
    orgId: row.orgId,
    subjectUserId: row.subjectUserId,
    goalId: row.goalId,
  });
  if (any) return null;
  const _id = new ObjectId();
  try {
    await cols.events.insertOne({ _id, ...legacyEventFrom(row) });
  } catch (err) {
    // A concurrent writer backfilled it first (the partial unique index on
    // `legacy: true`, or on the active grade per period, rejected ours) —
    // point at whatever legacy row won instead of duplicating it.
    if (!isDuplicateKeyError(err)) throw err;
    const winner = await cols.events.findOne({
      orgId: row.orgId,
      subjectUserId: row.subjectUserId,
      goalId: row.goalId,
      legacy: true,
    });
    return winner?._id ?? null;
  }
  return _id;
}

/**
 * Record a manager grade: supersede the previous grade in the same period,
 * append the new one, and refresh the current-grade projection (unless the
 * projection holds a strictly later period). A new grade clears the
 * report's acknowledgement — they haven't seen THIS one.
 */
export async function recordManagerVerdict(
  input: RecordManagerVerdictInput,
  cols?: VerdictCollections,
): Promise<RecordManagerVerdictResult> {
  const c = cols ?? (await defaultCollections());
  const now = input.now ?? new Date();
  const periodKey = isValidPeriodKey(input.periodKey)
    ? input.periodKey
    : defaultPeriodKey(now);
  const key = {
    orgId: input.orgId,
    subjectUserId: input.subjectUserId,
    goalId: input.goalId,
  };

  const existing = await c.current.findOne(key);
  const legacyId = await ensureLegacyEvent(c, existing);

  const activeFilter = { ...key, periodKey, supersededAt: null };
  let prev = await c.events.findOne(activeFilter, { sort: { gradedAt: -1 } });

  // Re-saving the same tier + note (e.g. the drawer opened pre-filled on
  // the existing grade) is not a re-grade: keep the ack, write nothing.
  if (prev && prev.tier === input.tier && prev.note === input.note) {
    return {
      periodKey,
      eventId: prev._id,
      before: {
        tier: prev.tier,
        note: prev.note,
        gradedByName: prev.gradedByName,
        gradedAt: prev.gradedAt,
      },
      current: Boolean(existing?.eventId && existing.eventId.equals(prev._id)),
      unchanged: true,
    };
  }

  // Supersede the active grade, then append. A partial unique index allows
  // ONE active event per (org, subject, goal, period); if a concurrent
  // grade slipped in between our supersede and insert, the insert collides
  // — supersede again (now covering the concurrent row) and retry once.
  const eventId = new ObjectId();
  const supersedeAndInsert = async () => {
    await c.events.updateMany(activeFilter, { $set: { supersededAt: now } });
    await c.events.insertOne({
      _id: eventId,
      ...key,
      periodKey,
      tier: input.tier,
      note: input.note,
      gradedBy: input.gradedBy,
      gradedByName: input.gradedByName,
      gradedAt: now,
      supersededAt: null,
      legacy: false,
      ack: null,
    });
  };
  try {
    await supersedeAndInsert();
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    prev = (await c.events.findOne(activeFilter, { sort: { gradedAt: -1 } })) ?? prev;
    await supersedeAndInsert();
  }

  const replace = shouldReplaceCurrent(
    existing ? verdictPeriodKey(existing) : null,
    periodKey,
  );
  if (replace) {
    await c.current.updateOne(
      key,
      {
        $set: {
          tier: input.tier,
          note: input.note,
          gradedBy: input.gradedBy,
          gradedByName: input.gradedByName,
          gradedAt: now,
          updatedAt: now,
          periodKey,
          eventId,
          ack: null,
        },
      },
      { upsert: true },
    );
  } else if (legacyId && existing && !existing.eventId) {
    // The legacy projection stays current — point it at its backfilled
    // event so a later acknowledgement lands on the right history row.
    await c.current.updateOne(key, { $set: { eventId: legacyId } });
  }

  return {
    periodKey,
    eventId,
    before: prev
      ? {
          tier: prev.tier,
          note: prev.note,
          gradedByName: prev.gradedByName,
          gradedAt: prev.gradedAt,
        }
      : null,
    current: replace,
    unchanged: false,
  };
}

/**
 * Back-compat name for callers written before grade history (the shared
 * goals module). Append-only under the hood — identical to
 * `recordManagerVerdict`, minus the result.
 */
export type UpsertManagerVerdictInput = RecordManagerVerdictInput;
export async function upsertManagerVerdict(
  input: UpsertManagerVerdictInput,
): Promise<void> {
  await recordManagerVerdict(input);
}

/**
 * The report acknowledges their CURRENT grade on a goal — "Seen", and
 * optionally "I disagree" with a note. Stamped on the current projection
 * and on the history event it mirrors. Returns null when there's no grade
 * to acknowledge. Re-acknowledging replaces the previous ack (a report may
 * change "seen" to "I disagree"); a re-grade clears it.
 */
export async function acknowledgeManagerVerdict(
  input: {
    orgId: ObjectId;
    subjectUserId: ObjectId;
    goalId: string;
    disagree: boolean;
    note: string;
    now?: Date;
    /**
     * The grade event the report is looking at, when the client sends it.
     * A mismatch with the current grade → `stale`.
     */
    eventId?: ObjectId | null;
  },
  cols?: VerdictCollections,
): Promise<
  | {
      ack: ManagerVerdictAck;
      verdict: ManagerGoalVerdict;
      /** The ack this one replaced (null on a first acknowledgement). */
      previousAck: ManagerVerdictAck | null;
    }
  | { stale: true }
  | null
> {
  const c = cols ?? (await defaultCollections());
  const key = {
    orgId: input.orgId,
    subjectUserId: input.subjectUserId,
    goalId: input.goalId,
  };
  const row = await c.current.findOne(key);
  if (!row) return null;
  if (
    input.eventId &&
    !(row.eventId && row.eventId.equals(input.eventId))
  ) {
    return { stale: true };
  }
  const ack: ManagerVerdictAck = {
    at: input.now ?? new Date(),
    disagree: input.disagree,
    note: input.disagree ? input.note.slice(0, 2_000) : "",
  };

  const legacyId = await ensureLegacyEvent(c, row);
  const eventId = row.eventId ?? legacyId;
  // Conditional on the grade we just read still being current: a re-grade
  // in between (new eventId, ack cleared) must not receive this ack — the
  // report hasn't seen that grade.
  const upd = await c.current.updateOne(
    {
      ...key,
      eventId: row.eventId ?? null,
      gradedAt: row.gradedAt,
    },
    { $set: { ack, ...(eventId && !row.eventId ? { eventId } : {}) } },
  );
  if (upd.matchedCount === 0) return { stale: true };
  if (eventId) {
    await c.events.updateOne({ _id: eventId, ...key }, { $set: { ack } });
  }
  return { ack, verdict: { ...row, ack }, previousAck: row.ack ?? null };
}

/** One goal's grade history (oldest first) plus its current grade. */
export async function listManagerVerdictHistory(
  orgId: ObjectId,
  subjectUserId: ObjectId,
  goalId: string,
  cols?: VerdictCollections,
): Promise<{ current: ManagerGoalVerdict | null; history: VerdictHistoryItem[] }> {
  const c = cols ?? (await defaultCollections());
  const key = { orgId, subjectUserId, goalId };
  const [current, events] = await Promise.all([
    c.current.findOne(key),
    c.events.find(key).sort({ gradedAt: 1 }).limit(200).toArray(),
  ]);
  return { current, history: buildVerdictHistory(events, current) };
}

/** The current grade's JSON shape (tier + who + when + period + ack). */
export function currentVerdictToJson(v: ManagerGoalVerdict | null) {
  if (!v) return null;
  return {
    goalId: v.goalId,
    tier: v.tier,
    note: v.note,
    gradedByName: v.gradedByName,
    gradedAt: v.gradedAt.toISOString(),
    periodKey: verdictPeriodKey(v),
    /** The grade event this is — the report echoes it on acknowledge. */
    eventId: v.eventId ? v.eventId.toHexString() : null,
    ack: ackToJson(v.ack),
  };
}

/**
 * All manager verdicts about one subject, keyed by goalId. Without a
 * `periodKey` this is the current projection (existing behaviour); with
 * one, it's the latest grade per goal IN that period from the history.
 */
export async function getManagerVerdictMap(
  orgId: ObjectId,
  subjectUserId: ObjectId,
  opts: { periodKey?: string | null } = {},
): Promise<Map<string, ManagerGoalVerdict>> {
  if (isValidPeriodKey(opts.periodKey)) {
    const events = await (await getManagerGoalVerdictEventsCollection())
      .find({ orgId, subjectUserId, periodKey: opts.periodKey })
      .toArray();
    const latest = latestPerGoalPerPeriod(events);
    return new Map(
      [...latest.values()].map((e) => [
        e.goalId,
        {
          _id: e._id,
          orgId: e.orgId,
          subjectUserId: e.subjectUserId,
          goalId: e.goalId,
          tier: e.tier,
          note: e.note,
          gradedBy: e.gradedBy,
          gradedByName: e.gradedByName,
          gradedAt: e.gradedAt,
          updatedAt: e.gradedAt,
          periodKey: e.periodKey,
          eventId: e._id,
          ack: e.ack,
        },
      ]),
    );
  }
  const col = await getManagerGoalVerdictsCollection();
  const rows = await col.find({ orgId, subjectUserId }).toArray();
  return new Map(rows.map((r) => [r.goalId, r]));
}

/** All manager verdicts about one subject (for the dev's own hydration). */
export async function listManagerVerdictsForSubject(
  orgId: ObjectId,
  subjectUserId: ObjectId,
): Promise<ManagerGoalVerdict[]> {
  const col = await getManagerGoalVerdictsCollection();
  return col.find({ orgId, subjectUserId }).toArray();
}

/** All manager verdicts across a set of subjects (the delegated queue). */
export async function listManagerVerdictsForSubjects(
  orgId: ObjectId,
  subjectUserIds: ObjectId[],
): Promise<ManagerGoalVerdict[]> {
  if (subjectUserIds.length === 0) return [];
  const col = await getManagerGoalVerdictsCollection();
  return col.find({ orgId, subjectUserId: { $in: subjectUserIds } }).toArray();
}

/**
 * Does this acknowledgement open a NEW dispute — worth notifying about?
 * Yes when it disagrees and the previous ack didn't, or the dispute note
 * changed. A repost of the same dispute (double-click, retry loop) is not.
 */
export function isNewDispute(
  previous: Pick<ManagerVerdictAck, "disagree" | "note"> | null | undefined,
  next: Pick<ManagerVerdictAck, "disagree" | "note">,
): boolean {
  if (!next.disagree) return false;
  return !previous?.disagree || previous.note !== next.note;
}
