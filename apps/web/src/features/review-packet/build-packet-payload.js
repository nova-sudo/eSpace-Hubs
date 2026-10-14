/**
 * Evidence-page rows → the v2 review-packet payload the API stores and the
 * HTML templates render.
 *
 * Pure: everything it reads arrives as an argument. The two store readers
 * (tier policy, manager verdict) come in through `readers`; with none passed
 * they read nothing. The barrel's `buildPacketPayload` binds the real
 * goal-tiers stores — see `build-packet-payload-live.js` for why that lives
 * in a separate file.
 *
 * The shape mirrors `apps/api/src/modules/review-packets/packet-body.ts`
 * field for field. Every string is clipped and every list capped here, so a
 * submit can't fail the API's validation on size.
 */

import { isSingleRecordWidget, resolveLadders, specCadence } from "@/features/goal-specs";

/** Serialised-JSON cap on the whole payload (API: MAX_PAYLOAD_CHARS). */
export const MAX_PAYLOAD_CHARS = 400_000;
/** Goal rows a packet may hold, objectives' goals + untracked (API: MAX_GOAL_ROWS). */
export const MAX_GOAL_ROWS = 500;
const MAX_OBJECTIVES = 200;
const MAX_WINDOWS = 60;
const MAX_EVIDENCE = 200;

const TITLE = 1_000;
const TEXT = 4_000;
const ID = 200;

const TIERS = ["not_achieved", "achieved", "over_achieved", "role_model"];
const TIER_KEY = {
  not_achieved: "notAchieved",
  achieved: "achieved",
  over_achieved: "overAchieved",
  role_model: "roleModel",
};

const NO_READERS = { readTierPolicy: () => null, readManagerVerdict: () => null };

/* ─────────────────────────── small helpers ─────────────────────────── */

function clip(value, max) {
  if (value == null) return null;
  const s = typeof value === "string" ? value : String(value);
  return s.slice(0, max);
}

const clipOr = (value, max, fallback = "") => clip(value, max) ?? fallback;

const isTier = (t) => TIERS.includes(t);

/** A date-ish value (ISO string, ms number, Date) → string, else null. */
function toDateString(value, max = 100) {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value.slice(0, max);
  const d = value instanceof Date ? value : typeof value === "number" ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toWeight(weightage) {
  const n = typeof weightage === "number" ? weightage : Number.parseFloat(weightage);
  return Number.isFinite(n) ? n : 0;
}

function ladder(tiers) {
  if (!tiers || typeof tiers !== "object") return null;
  return {
    notAchieved: clip(tiers.notAchieved, TEXT),
    achieved: clip(tiers.achieved, TEXT),
    overAchieved: clip(tiers.overAchieved, TEXT),
    roleModel: clip(tiers.roleModel, TEXT),
  };
}

/** A short "op value unit / period" target, when the spec states one. */
function targetOf(spec) {
  const t = spec?.source?.target ?? spec?.manual?.target ?? spec?.target ?? null;
  if (!t || typeof t !== "object" || t.value == null) return null;
  const unit = spec?.manual?.unit ? ` ${spec.manual.unit}` : "";
  const period = t.period ? ` / ${t.period}` : "";
  return clip(`${t.op ? `${t.op} ` : ""}${t.value}${unit}${period}`, TITLE);
}

/** A graded verdict (not awaiting / pending setup, known tier), else null. */
function gradedVerdict(v) {
  if (!v || v.awaiting || v.pendingSetup || !isTier(v.tier)) return null;
  return v;
}

/* ─────────────────────────── per-goal mapping ─────────────────────────── */

function mapWindows(windowsFor, goalId, spec) {
  let list = [];
  try {
    list = typeof windowsFor === "function" ? windowsFor(goalId, spec) : [];
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) return [];
  // Most recent windows are the ones a reviewer reads — keep the tail.
  return list.slice(-MAX_WINDOWS).map((w) => ({
    key: clipOr(w?.key, ID),
    label: clipOr(w?.label, ID),
    state: clipOr(w?.state, 30),
    verdict: isTier(w?.verdict) ? w.verdict : null,
  }));
}

function mapEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence.slice(0, MAX_EVIDENCE).map((e) => ({
    at: toDateString(e?.ts ?? e?.at) ?? "",
    text: clipOr(e?.text, TEXT),
    link: clip(e?.link ?? e?.url ?? null, 2_000),
  }));
}

function mapGoal(row, readers, windowsFor) {
  const { goal, spec, reading } = row;
  const ladders = resolveLadders(spec, readers.readTierPolicy(goal.id));
  const v = gradedVerdict(row.verdict);
  const mv = readers.readManagerVerdict(goal.id);
  return {
    id: clipOr(goal.id, ID),
    title: clipOr(goal.title, TITLE),
    kind: clipOr(spec?.widget, 100),
    cadence: isSingleRecordWidget(spec?.widget) ? null : clip(specCadence(spec), 100),
    target: targetOf(spec),
    reading: clip(reading?.value, TEXT),
    statusLabel: clip(reading?.statusLabel, TEXT),
    statusReason: clip(reading?.statusReason, TEXT),
    tiers: ladder(ladders.final),
    cadenceTiers: ladders.cadenceFallback ? null : ladder(ladders.cadence),
    verdict: v
      ? {
          tier: v.tier,
          reasoning: clipOr(v.reasoning, TEXT),
          lowConfidence: v.confidence === "low",
          gradedAt: toDateString(v.gradedAt),
        }
      : null,
    managerVerdict:
      mv && isTier(mv.tier)
        ? { tier: mv.tier, note: clip(mv.note || null, TEXT), gradedAt: toDateString(mv.gradedAt) }
        : null,
    windows: mapWindows(windowsFor, goal.id, spec),
    evidence: mapEvidence(row.evidence),
  };
}

/* ─────────────────────────── size fitting ─────────────────────────── */

/** Trim the bulkiest per-goal lists until the payload fits. Goals are
 *  never dropped — a reviewer must see every goal, with less proof. */
function fitToCap(payload) {
  const size = () => JSON.stringify(payload).length;
  if (size() <= MAX_PAYLOAD_CHARS) return payload;
  const goals = payload.objectives.flatMap((o) => o.goals);
  const steps = [
    (g) => (g.evidence = g.evidence.slice(0, 20)),
    (g) => (g.evidence = g.evidence.map((e) => ({ ...e, text: e.text.slice(0, 500) }))),
    (g) => (g.windows = g.windows.slice(-12)),
    (g) => (g.evidence = g.evidence.slice(0, 5)),
    (g) => (g.evidence = []),
    (g) => (g.windows = []),
    (g) => g.verdict && (g.verdict.reasoning = g.verdict.reasoning.slice(0, 500)),
    (g) => {
      g.tiers = null;
      g.cadenceTiers = null;
    },
    (g) => shortenText(g, 500),
  ];
  for (const step of steps) {
    goals.forEach(step);
    if (size() <= MAX_PAYLOAD_CHARS) return payload;
  }
  // Last resort (hundreds of goals): shorter text and titles everywhere,
  // still with every goal present.
  for (const [text, titleMax] of [[120, 120], [40, 60], [0, 40]]) {
    goals.forEach((g) => {
      shortenText(g, text);
      g.title = g.title.slice(0, titleMax);
    });
    for (const o of payload.objectives) {
      o.title = o.title.slice(0, titleMax);
      o.reading = clip(o.reading, text);
    }
    payload.untracked.forEach((u) => {
      u.title = u.title.slice(0, titleMax);
      u.l1Title = u.l1Title.slice(0, titleMax);
    });
    if (size() <= MAX_PAYLOAD_CHARS) break;
  }
  return payload;
}

function shortenText(g, max) {
  g.reading = clip(g.reading, max);
  g.statusLabel = clip(g.statusLabel, max);
  g.statusReason = clip(g.statusReason, max);
  if (g.verdict) g.verdict.reasoning = g.verdict.reasoning.slice(0, max);
  if (g.managerVerdict) g.managerVerdict.note = clip(g.managerVerdict.note, max);
}

/* ─────────────────────────── entry ─────────────────────────── */

/**
 * @param {object} input
 * @param {object[]} input.goalReadings  `useGoalReadings()` rows
 * @param {{id,title,l1Title}[]} [input.untracked]
 * @param {{displayName?,level?,department?}} [input.submitter]
 * @param {string} [input.rangeLabel]
 * @param {string|number|Date} [input.rangeStart]
 * @param {string|number|Date} [input.rangeEnd]
 * @param {string} [input.cycleKey]
 * @param {(goalId: string, spec: object) => {key,label,state,verdict}[]} [input.windowsFor]
 * @param {{readTierPolicy?, readManagerVerdict?}} [readers]
 */
export function buildPacketPayload(input = {}, readers = NO_READERS) {
  const r = { ...NO_READERS, ...readers };
  const {
    goalReadings = [],
    untracked = [],
    submitter = {},
    rangeLabel,
    rangeStart,
    rangeEnd,
    cycleKey,
    windowsFor,
  } = input;

  const objectives = [];
  const byId = new Map();
  const objectiveFor = (l1, l1Row = null) => {
    const id = clipOr(l1?.id, ID, "__ungrouped");
    let o = byId.get(id);
    if (!o) {
      if (objectives.length >= MAX_OBJECTIVES) return null;
      o = {
        id,
        title: clipOr(l1?.title, TITLE, l1 ? "" : "Other goals"),
        weight: toWeight(l1?.weightage),
        reading: null,
        goals: [],
      };
      byId.set(id, o);
      objectives.push(o);
    }
    if (l1Row) o.reading = clip(l1Row.reading?.value, TEXT);
    return o;
  };

  const byTier = { notAchieved: 0, achieved: 0, overAchieved: 0, roleModel: 0 };
  let tracked = 0;
  const rows = Array.isArray(goalReadings) ? goalReadings : [];
  for (const row of rows) {
    if (!row?.goal?.id) continue;
    if (row.level === "L1") {
      objectiveFor(row.goal, row);
      continue;
    }
    if (row.level !== "L2" || !row.spec || tracked >= MAX_GOAL_ROWS) continue;
    const o = objectiveFor(row.parentL1);
    if (!o) continue;
    o.goals.push(mapGoal(row, r, windowsFor));
    tracked += 1;
    const v = gradedVerdict(row.verdict);
    if (v) byTier[TIER_KEY[v.tier]] += 1;
  }

  const untrackedOut = (Array.isArray(untracked) ? untracked : [])
    .filter((u) => u?.id)
    .slice(0, MAX_GOAL_ROWS - tracked)
    .map((u) => ({ id: clipOr(u.id, ID), title: clipOr(u.title, TITLE), l1Title: clipOr(u.l1Title, TITLE) }));

  return fitToCap({
    range: {
      label: clipOr(rangeLabel, ID),
      start: toDateString(rangeStart),
      end: toDateString(rangeEnd),
    },
    cycleKey: clip(cycleKey || null, ID),
    submitter: {
      displayName: clip(submitter?.displayName || null, TITLE),
      level: clip(submitter?.level || null, 100),
      department: clip(submitter?.department || null, TITLE),
    },
    objectives,
    untracked: untrackedOut,
    totals: { goals: tracked + untrackedOut.length, tracked, byTier },
  });
}
