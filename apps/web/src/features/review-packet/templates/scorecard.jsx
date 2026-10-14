"use client";

import { motion } from "framer-motion";
import { Badge, Card, Label } from "@/components/ui";
import { CountUp } from "./shared/count-up";
import { useMotionPresets } from "./shared/motion";
import { TierChip } from "./shared/tier-chip";
import { WeightRing } from "./shared/weight-ring";

const TIER_STATS = [
  { key: "notAchieved", label: "Not achieved", tone: "peach" },
  { key: "achieved", label: "Achieved", tone: "mint" },
  { key: "overAchieved", label: "Over achieved", tone: "sky" },
  { key: "roleModel", label: "Role model", tone: "lav" },
];

function fmtReading(v) {
  if (v == null || v === "") return null;
  return String(v);
}

function GoalRow({ goal, mode, item }) {
  const verdict = goal.verdict;
  const tier = goal.managerVerdict?.tier || verdict?.tier || null;
  const reading = fmtReading(goal.reading);
  const target = fmtReading(goal.target);
  const evidence = mode === "page" ? (goal.evidence ?? []) : [];
  return (
    <motion.li variants={item} className="flex flex-col gap-2 rounded-[var(--radius-lg)] bg-card-alt px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="break-words text-[14px] font-semibold text-fg">{goal.title}</p>
          {reading || target ? (
            <p className="mt-0.5 text-[12.5px] text-muted-fg">
              {reading ?? "No reading"}
              {target ? <> <span aria-hidden="true">/</span> target {target}</> : null}
            </p>
          ) : goal.statusLabel ? (
            <p className="mt-0.5 text-[12.5px] text-muted-fg">{goal.statusLabel}</p>
          ) : null}
        </div>
        <TierChip tier={tier} manager={!!goal.managerVerdict?.tier} />
      </div>
      {evidence.length ? (
        <details className="group">
          <summary className="cursor-pointer select-none text-[12px] font-semibold text-muted-fg">
            Evidence ({evidence.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {evidence.map((e, i) => (
              <li key={`${e.at}-${i}`} className="break-words text-[12.5px] text-fg">
                <span className="text-muted-fg">{e.at ? `${String(e.at).slice(0, 10)} - ` : ""}</span>
                {e.link ? (
                  <a href={e.link} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {e.text || e.link}
                  </a>
                ) : (
                  e.text
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </motion.li>
  );
}

export function Scorecard({ payload, mode = "page" }) {
  const { reduced, container, item } = useMotionPresets();
  const all = payload?.objectives ?? [];
  const totals = payload?.totals ?? { goals: 0, tracked: 0, byTier: {} };
  const goalCount = all.reduce((n, o) => n + (o.goals?.length ?? 0), 0);
  const untracked = payload?.untracked ?? [];

  if (goalCount === 0) {
    return (
      <div className="px-4 sm:px-0" data-mode={mode}>
        <Card className="text-[14px] text-muted-fg">Nothing tracked yet.</Card>
      </div>
    );
  }

  const objectives = mode === "preview" ? all.slice(0, 1) : all;
  const initial = reduced ? false : "hidden";

  return (
    <div className="flex flex-col gap-4 px-4 sm:px-0" data-mode={mode}>
      <motion.div variants={container} initial={initial} animate="show" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <motion.div variants={item}>
          <Card padding={16} className="h-full">
            <Label caps>Goals</Label>
            <p className="mt-1 text-[28px] font-extrabold leading-none text-fg"><CountUp value={totals.goals} /></p>
          </Card>
        </motion.div>
        <motion.div variants={item}>
          <Card padding={16} className="h-full">
            <Label caps>Tracked</Label>
            <p className="mt-1 text-[28px] font-extrabold leading-none text-fg"><CountUp value={totals.tracked} /></p>
          </Card>
        </motion.div>
        {TIER_STATS.map((t) => (
          <motion.div key={t.key} variants={item}>
            <Card tone={t.tone} padding={16} className="h-full">
              <span className="text-[11px] font-bold tracking-[0.06em] uppercase opacity-80">{t.label}</span>
              <p className="mt-1 text-[28px] font-extrabold leading-none"><CountUp value={totals.byTier?.[t.key] ?? 0} /></p>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {objectives.map((o) => (
        <motion.section key={o.id} variants={container} initial={initial} animate="show">
          <Card className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <WeightRing weight={o.weight} />
              <div className="min-w-0">
                <h2 className="break-words text-[16px] font-bold text-fg">{o.title}</h2>
                <Label>{(o.goals?.length ?? 0)} {(o.goals?.length ?? 0) === 1 ? "goal" : "goals"}</Label>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {(o.goals ?? []).map((g) => (
                <GoalRow key={g.id} goal={g} mode={mode} item={item} />
              ))}
            </ul>
          </Card>
        </motion.section>
      ))}

      {mode === "page" && untracked.length ? (
        <Card tone={undefined} className="flex flex-col gap-2 bg-card-alt">
          <Label caps>Not yet tracked</Label>
          <ul className="flex flex-col gap-1">
            {untracked.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-fg">
                <span className="break-words">{u.title}</span>
                {u.l1Title ? <Badge>{u.l1Title}</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
