"use client";

import { motion } from "framer-motion";
import { Card, Label } from "@/components/ui";
import { useMotionPresets } from "./shared/motion";
import { TierSeal } from "./shared/tier-seal";
import { windowSummary } from "./shared/window-state";
import { WeightRing } from "./shared/weight-ring";

function shortDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function GoalBlock({ goal, mode, item }) {
  const tier = goal.managerVerdict?.tier || goal.verdict?.tier || null;
  const manager = !!goal.managerVerdict?.tier;
  const hasReading = goal.reading != null && goal.reading !== "";
  const hasTarget = goal.target != null && goal.target !== "";
  const summary = (goal.windows ?? []).length ? windowSummary(goal.windows).text : null;
  const evidence = mode === "page" ? (goal.evidence ?? []) : [];
  const reasoning = goal.verdict?.reasoning;
  return (
    <motion.div variants={item} className="flex flex-col gap-1.5 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 className="min-w-0 flex-1 basis-48 break-words text-[15px] font-bold text-fg">{goal.title}</h3>
        <TierSeal tier={tier} manager={manager} />
      </div>
      {hasReading || hasTarget ? (
        <p className="text-[13px] text-muted-fg">
          {hasReading ? String(goal.reading) : "No reading"}
          {hasTarget ? ` against a target of ${goal.target}` : ""}
        </p>
      ) : goal.statusLabel ? (
        <p className="text-[13px] text-muted-fg">{goal.statusLabel}</p>
      ) : null}
      {summary ? <p className="text-[13px] text-muted-fg">{summary}.</p> : null}
      {reasoning ? <p className="break-words text-[13.5px] leading-relaxed text-fg">{reasoning}</p> : null}
      {goal.managerVerdict?.note ? (
        <p className="break-words text-[13.5px] leading-relaxed text-fg">Manager note: {goal.managerVerdict.note}</p>
      ) : null}
      {evidence.length ? (
        <ul className="mt-1 flex flex-col gap-1">
          {evidence.map((e, i) => (
            <li key={`${e.at}-${i}`} className="break-words text-[12.5px] text-fg">
              <span className="text-muted-fg">{shortDate(e.at)}{e.at ? " · " : ""}</span>
              {e.text}
              {e.link ? (
                <>
                  {e.text ? " " : ""}
                  <a href={e.link} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {e.text ? "link" : e.link}
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </motion.div>
  );
}

export function Dossier({ payload, mode = "page", submittedAt }) {
  const { reduced, container, item } = useMotionPresets();
  const preview = mode !== "page";
  const all = payload?.objectives ?? [];
  const objectives = preview ? all.slice(0, 1) : all;
  const untracked = preview ? [] : (payload?.untracked ?? []);
  const empty = !all.some((o) => (o.goals ?? []).length);
  const submitter = payload?.submitter ?? {};
  const meta = [submitter.department, submitter.level].filter(Boolean).join(" · ");
  const frozen = submittedAt ? shortDate(submittedAt) : "—";

  return (
    <Card className="packet-dossier mx-auto flex w-full max-w-[760px] flex-col gap-8 p-6 sm:p-12" data-mode={mode}>
      <header className="flex flex-col gap-1 border-b border-line pb-6">
        <Label caps>Review packet</Label>
        <h1 className="break-words text-[28px] font-bold leading-tight text-fg">{submitter.displayName || "Review packet"}</h1>
        {payload?.range?.label ? <p className="text-[14px] text-muted-fg">{payload.range.label}</p> : null}
        {meta ? <p className="text-[13px] text-muted-fg">{meta}</p> : null}
      </header>

      {empty ? (
        <p className="text-[13px] text-muted-fg">Nothing tracked yet.</p>
      ) : (
        <motion.div
          variants={container}
          initial={reduced ? false : "hidden"}
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          className="flex flex-col gap-10"
        >
          {objectives.map((o, idx) => (
            <motion.section key={o.id} variants={item} className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="min-w-0 break-words text-[18px] font-bold text-fg">
                  <span className="tabular-nums text-muted-fg">{String(idx + 1).padStart(2, "0")}</span> · {o.title}
                </h2>
                <WeightRing weight={o.weight} size={44} />
              </div>
              <motion.div variants={container} className="flex flex-col gap-4">
                {(o.goals ?? []).map((g) => (
                  <GoalBlock key={g.id} goal={g} mode={mode} item={item} />
                ))}
              </motion.div>
            </motion.section>
          ))}
        </motion.div>
      )}

      {untracked.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[15px] font-bold text-fg">Not yet tracked</h2>
          <ul className="flex flex-col gap-1">
            {untracked.map((u) => (
              <li key={u.id} className="break-words text-[13px] text-muted-fg">
                {u.title}
                {u.l1Title ? ` (${u.l1Title})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="border-t border-line pt-4">
        <p className="text-[12px] text-muted-fg">Frozen on {frozen} · eSpace Hubs</p>
      </footer>
    </Card>
  );
}
