"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { TIER_LABELS, tierTone } from "@/features/goal-tiers";
import { CountUp } from "./shared/count-up";
import { useMotionPresets } from "./shared/motion";
import { TierChip } from "./shared/tier-chip";
import { useDeckNav } from "./shared/use-deck-nav";
import { WeightRing } from "./shared/weight-ring";

const TIER_STATS = [
  { key: "notAchieved", label: "Not achieved", tone: "peach" },
  { key: "achieved", label: "Achieved", tone: "mint" },
  { key: "overAchieved", label: "Over achieved", tone: "sky" },
  { key: "roleModel", label: "Role model", tone: "lav" },
];

const DOT_CLASS = {
  done: "bg-mint",
  complete: "bg-mint",
  missed: "bg-peach",
  open: "bg-sky",
  current: "bg-sky",
  before: "bg-card-alt opacity-60",
};

const SWIPE = 80;
const SLIDE = {
  enter: (d) => ({ opacity: 0, x: d * 40 }),
  center: { opacity: 1, x: 0 },
  exit: (d) => ({ opacity: 0, x: d * -40 }),
};

const fmt = (v) => (v == null || v === "" ? null : String(v));
const tierOf = (g) => g.managerVerdict?.tier || g.verdict?.tier || null;

function buildCards(objectives) {
  const cards = [{ type: "cover" }];
  for (const o of objectives) for (const g of o.goals ?? []) cards.push({ type: "goal", objective: o, goal: g });
  cards.push({ type: "summary" });
  return cards;
}

function Cover({ payload, objectives, goalCount, mode }) {
  const totals = payload?.totals ?? { byTier: {} };
  const s = payload?.submitter ?? {};
  const sub = [s.level, s.department].filter(Boolean).join(" / ");
  return (
    <div className="flex h-full flex-col justify-between gap-6">
      <div className="flex flex-col gap-2">
        <Label caps>{payload?.range?.label ?? "Review packet"}</Label>
        <h2 className="break-words text-[28px] font-extrabold leading-tight text-fg sm:text-[40px]">
          {s.displayName ?? "Review packet"}
        </h2>
        {sub ? <p className="text-[14px] text-muted-fg">{sub}</p> : null}
        <p className="text-[14px] text-muted-fg">
          {objectives.length} {objectives.length === 1 ? "objective" : "objectives"}, {goalCount} {goalCount === 1 ? "goal" : "goals"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TIER_STATS.map((t) => (
          <div key={t.key} className="rounded-[var(--radius-lg)] bg-card-alt px-4 py-3">
            <Badge tone={t.tone}>{t.label}</Badge>
            <p className="mt-2 text-[28px] font-extrabold leading-none text-fg">
              <CountUp value={totals.byTier?.[t.key] ?? 0} />
            </p>
          </div>
        ))}
      </div>
      {mode === "preview" ? <Label>Open to flip through</Label> : null}
    </div>
  );
}

function GoalCard({ objective, goal }) {
  const tier = tierOf(goal);
  const reading = fmt(goal.reading);
  const target = fmt(goal.target);
  const reasoning = goal.verdict?.reasoning;
  const windows = goal.windows ?? [];
  const evidence = goal.evidence ?? [];
  const shown = evidence.slice(-3);
  const more = evidence.length - shown.length;
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label>{objective.title}</Label>
        <h2 className="break-words text-[22px] font-extrabold leading-tight text-fg sm:text-[30px]">{goal.title}</h2>
        {reading || target ? (
          <p className="text-[14px] text-muted-fg">
            {reading ?? "No reading"}
            {target ? <> <span aria-hidden="true">/</span> target {target}</> : null}
          </p>
        ) : goal.statusLabel ? (
          <p className="text-[14px] text-muted-fg">{goal.statusLabel}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="origin-left scale-125 pl-1"><TierChip tier={tier} manager={!!goal.managerVerdict?.tier} standalone /></span>
      </div>
      {goal.managerVerdict?.note ? (
        <p className="break-words text-[13px] text-fg"><Label>Manager note </Label>{goal.managerVerdict.note}</p>
      ) : null}
      {reasoning ? (
        <blockquote className="break-words rounded-[var(--radius-lg)] bg-card-alt px-4 py-3 text-[13.5px] italic text-fg">
          {reasoning}
        </blockquote>
      ) : null}
      {windows.length ? (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Windows">
          {windows.map((w) => {
            const label = `${w.label ?? w.key}: ${w.state ?? "unknown"}${w.verdict?.tier ? `, ${TIER_LABELS[w.verdict.tier] ?? w.verdict.tier}` : ""}`;
            return (
              <span key={w.key} role="listitem" aria-label={label} title={label}
                className={`h-3 w-3 rounded-full ${DOT_CLASS[w.state] ?? "bg-card-alt"}`} />
            );
          })}
        </div>
      ) : null}
      {shown.length ? (
        <ul className="flex flex-col gap-1">
          {shown.map((e, i) => (
            <li key={`${e.at}-${i}`} className="break-words text-[12.5px] text-fg">
              <span className="text-muted-fg">{e.at ? `${String(e.at).slice(0, 10)} - ` : ""}</span>
              {e.link ? (
                <a href={e.link} target="_blank" rel="noreferrer" className="underline underline-offset-2">{e.text || e.link}</a>
              ) : e.text}
            </li>
          ))}
          {more > 0 ? <li className="text-[12px] font-semibold text-muted-fg">+{more} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function Summary({ objectives, untracked, goalCount }) {
  return (
    <div className="flex h-full flex-col gap-4">
      <Label caps>Summary</Label>
      {goalCount === 0 ? (
        <p className="text-[14px] text-muted-fg">Nothing tracked yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {objectives.map((o) => {
            const counts = {};
            for (const g of o.goals ?? []) {
              const t = tierOf(g);
              if (t) counts[t] = (counts[t] ?? 0) + 1;
            }
            return (
              <li key={o.id} className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-card-alt px-4 py-3">
                <WeightRing weight={o.weight} size={48} />
                <div className="min-w-0">
                  <p className="break-words text-[14px] font-bold text-fg">{o.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.keys(counts).length ? Object.entries(counts).map(([t, n]) => (
                      <Badge key={t} tone={tierTone(t)}>{n} {TIER_LABELS[t] ?? t}</Badge>
                    )) : <Label>No graded goals</Label>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[13px] text-muted-fg">
        {untracked.length} not yet tracked
      </p>
    </div>
  );
}

export function Deck({ payload, mode = "page" }) {
  const { reduced } = useMotionPresets();
  const objectives = payload?.objectives ?? [];
  const untracked = payload?.untracked ?? [];
  const goalCount = objectives.reduce((n, o) => n + (o.goals?.length ?? 0), 0);
  const cards = buildCards(objectives);
  const preview = mode === "preview";
  const { index, direction, next, prev, goTo } = useDeckNav(preview ? 1 : cards.length);
  const card = cards[preview ? 0 : index];
  const total = preview ? 1 : cards.length;

  const body =
    card.type === "cover" ? <Cover payload={payload} objectives={objectives} goalCount={goalCount} mode={mode} />
    : card.type === "goal" ? <GoalCard objective={card.objective} goal={card.goal} />
    : <Summary objectives={objectives} untracked={untracked} goalCount={goalCount} />;

  const onDragEnd = (_e, info) => {
    if (info.offset.x <= -SWIPE) next();
    else if (info.offset.x >= SWIPE) prev();
  };

  return (
    <div className="flex flex-col gap-3 px-4 sm:px-0" data-mode={mode}>
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="Review deck"
        aria-live="polite"
        className="overflow-hidden rounded-[var(--radius-xl)]"
      >
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={preview ? "cover" : index}
            custom={direction}
            variants={SLIDE}
            initial={reduced ? false : "enter"}
            animate="center"
            exit={reduced ? { opacity: 1 } : "exit"}
            transition={reduced ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            drag={preview ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={onDragEnd}
            aria-roledescription="slide"
            aria-label={`Card ${(preview ? 0 : index) + 1} of ${total}`}
          >
            <Card className="h-auto overflow-y-auto p-5 sm:aspect-[16/10] sm:max-h-[70vh] sm:p-8">{body}</Card>
          </motion.div>
        </AnimatePresence>
      </div>

      {!preview ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="soft" size="sm" onClick={prev} disabled={index === 0} aria-label="Previous card">
            <ChevronLeft size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Previous</span>
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {cards.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Card ${i + 1} of ${total}`}
                aria-current={i === index ? "true" : undefined}
                className={`h-2.5 rounded-full transition-all ${i === index ? "w-6 bg-ink" : "w-2.5 bg-card-alt"}`}
              />
            ))}
          </div>
          <Button variant="soft" size="sm" onClick={next} disabled={index === total - 1} aria-label="Next card">
            <span className="hidden sm:inline">Next</span>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
