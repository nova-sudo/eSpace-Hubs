"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Badge, Card, Label } from "@/components/ui";
import { TIER_LABELS, tierTextColor } from "@/features/goal-tiers";
import { useMotionPresets, stagger } from "./shared/motion";
import { TierChip } from "./shared/tier-chip";
import { WeightRing } from "./shared/weight-ring";
import { WindowStrip, trackColumns } from "./shared/window-strip";

const STATE_CLASS = {
  done: "bg-mint text-mint-ink",
  complete: "bg-mint text-mint-ink",
  missed: "bg-peach text-peach-ink",
  before: "bg-card-alt text-muted-fg opacity-60",
  open: "bg-sky text-sky-ink",
  current: "bg-sky text-sky-ink",
};

function fmt(v) {
  return v == null || v === "" ? null : String(v);
}

function unionWindows(objectives) {
  const seen = new Map();
  for (const o of objectives) {
    for (const g of o.goals ?? []) {
      for (const w of g.windows ?? []) {
        if (w?.key != null && !seen.has(w.key)) seen.set(w.key, { key: w.key, label: w.label ?? String(w.key) });
      }
    }
  }
  return [...seen.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function Cell({ w, index, reduced }) {
  const cls = w ? (STATE_CLASS[w.state] ?? "bg-card-alt text-fg") : "bg-card-alt opacity-40";
  const tier = w?.verdict?.tier ?? (typeof w?.verdict === "string" ? w.verdict : null);
  const label = w ? `${w.label ?? w.key}: ${w.state ?? "unknown"}${tier ? `, ${TIER_LABELS[tier] ?? tier}` : ""}` : undefined;
  return (
    <motion.div
      role={w ? "img" : undefined}
      aria-label={label}
      title={label}
      initial={reduced ? false : { opacity: 0, scale: 0.8 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={reduced ? { duration: 0 } : { duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: stagger(index, 0.04, 0.5) }}
      className={`flex aspect-square min-w-[28px] items-center justify-center rounded-[var(--radius-md)] ${cls}`}
    >
      {tier ? (
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: tierTextColor(tier) }}
        />
      ) : null}
    </motion.div>
  );
}

function GoalRow({ goal, columns, mode, reduced, item }) {
  const tier = goal.managerVerdict?.tier || goal.verdict?.tier || null;
  const reading = fmt(goal.reading);
  const target = fmt(goal.target);
  const byKey = new Map((goal.windows ?? []).map((w) => [w.key, w]));
  const hasWindows = byKey.size > 0 && columns.length > 0;
  const evidence = mode === "page" ? (goal.evidence ?? []) : [];
  return (
    <motion.li variants={item} className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-card px-4 py-3">
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
      {hasWindows ? (
        <div className="overflow-x-auto">
          <div className="grid gap-1" style={trackColumns(columns.length)}>
            {columns.map((c, i) => (
              <Cell key={c.key} w={byKey.get(c.key) ?? null} index={i} reduced={reduced} />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] bg-card-alt px-3 py-2 text-[13px] text-fg">
          <span className="min-w-0 break-words">{reading ?? goal.statusLabel ?? "No windows"}</span>
          <TierChip tier={tier} manager={!!goal.managerVerdict?.tier} />
        </div>
      )}
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

export function Journey({ payload, mode = "page" }) {
  const { reduced, container, item } = useMotionPresets();
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);

  const all = payload?.objectives ?? [];
  const goalCount = all.reduce((n, o) => n + (o.goals?.length ?? 0), 0);
  const untracked = payload?.untracked ?? [];

  if (goalCount === 0) {
    return (
      <div className="px-4 sm:px-0" data-mode={mode}>
        <Card className="text-[14px] text-muted-fg">Nothing tracked yet.</Card>
      </div>
    );
  }

  const columns = unionWindows(all);
  const objectives = mode === "preview" ? all.slice(0, 1) : all;
  const initial = reduced ? false : "hidden";

  return (
    <div ref={ref} className="flex flex-col gap-4 px-4 sm:px-0" data-mode={mode}>
      {columns.length ? (
        <WindowStrip windows={columns} progress={reduced ? null : scaleX} />
      ) : (
        <Card className="text-[14px] text-muted-fg">No windows in this cycle.</Card>
      )}

      {objectives.map((o) => (
        <motion.section key={o.id} variants={container} initial={initial} animate="show">
          <Card className="flex flex-col gap-4 bg-card-alt">
            <div className="flex items-center gap-4">
              <WeightRing weight={o.weight} />
              <div className="min-w-0">
                <h2 className="break-words text-[16px] font-bold text-fg">{o.title}</h2>
                <Label>{(o.goals?.length ?? 0)} {(o.goals?.length ?? 0) === 1 ? "goal" : "goals"}</Label>
              </div>
            </div>
            <ul className="flex flex-col gap-2">
              {(o.goals ?? []).map((g) => (
                <GoalRow key={g.id} goal={g} columns={columns} mode={mode} reduced={reduced} item={item} />
              ))}
            </ul>
          </Card>
        </motion.section>
      ))}

      {mode === "page" && untracked.length ? (
        <Card className="flex flex-col gap-2">
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
