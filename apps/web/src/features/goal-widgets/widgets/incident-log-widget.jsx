"use client";

import { useMemo, useState } from "react";
import { WidgetShell } from "../widget-shell";
import { useGoalInputs } from "@/features/goal-inputs";
import { fullDate } from "@/lib/date";

/**
 * Incident log — one entry per SLA-affecting event.
 *
 * Each entry stores `{ severity, downtime, link? }` as the input
 * `value`. The widget computes:
 *   - Total downtime over the goal's window (or all-time if no target.period).
 *   - MTTR (mean downtime per incident).
 *   - Count of incidents.
 *   - % of SLA budget consumed when `spec.manual.target.value` is set
 *     (target.value = the budget in minutes for the period).
 *
 * UX: the headline is "<minutes consumed> / <budget>" when a budget
 * exists, else just total downtime. A small severity chip strip
 * shows distribution. Entries below are the raw log (newest first).
 *
 * Why a dedicated widget vs. COUNTER + DATE_LOG?
 *   - The structured `{ severity, downtime, link }` shape lets MTTR
 *     and severity-mix render without each user inventing their own
 *     convention.
 *   - "Budget consumed" framing matches how reliability goals are
 *     written in practice ("≤ 43 minutes/quarter") — a plain counter
 *     of incidents doesn't tell you whether you're inside the budget.
 */
export function IncidentLogWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { entries, append, remove } = useGoalInputs(goal?.id);
  const [severity, setSeverity] = useState("P2");
  const [downtime, setDowntime] = useState("");
  const [link, setLink] = useState("");

  const target = spec.manual?.target;
  const period = target?.period || spec.manual?.cadence;
  // Window the "consumed" budget against. Pure all-time if the spec
  // didn't tell us a period — the widget's headline simply degrades
  // to "Σ minutes" rather than a budget bar.
  const windowed = useMemo(
    () => filterByPeriod(entries, period),
    [entries, period],
  );

  const totals = useMemo(() => computeTotals(windowed), [windowed]);
  const unit = spec.manual?.unit || "minutes";
  const promptCopy =
    spec.manual?.prompt || "Log this incident: severity, downtime, link.";

  function logIncident() {
    const minutes = Number(downtime);
    if (!Number.isFinite(minutes) || minutes < 0) return;
    append({
      severity,
      downtime: minutes,
      ...(link.trim() ? { link: link.trim() } : {}),
    });
    setDowntime("");
    setLink("");
  }

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Incidents · ${entries.length}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col gap-2">
        <Headline
          totals={totals}
          budget={target?.value}
          unit={unit}
          period={period}
          variant={variant}
        />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color:
              variant === "light"
                ? "rgba(255,255,255,0.68)"
                : "var(--muted-fg)",
          }}
        >
          {promptCopy}
        </div>
        {totals.bySeverity.length > 0 ? (
          <SeverityRow
            distribution={totals.bySeverity}
            variant={variant}
          />
        ) : null}

        {/* Input row. severity is a tight <select>; downtime is a
            numeric input; link is optional. Same min-w-0 chain as the
            date-log widget so the tile never overflows on narrow grids. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              border:
                variant === "light"
                  ? "1px solid rgba(255,255,255,0.25)"
                  : "1px solid var(--border)",
              background:
                variant === "light"
                  ? "rgba(255,255,255,0.08)"
                  : "var(--card-alt)",
            }}
            aria-label="Severity"
          >
            {SEVERITY_LEVELS.map((s) => (
              <option key={s} value={s} style={{ color: "#000" }}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={downtime}
            onChange={(e) => setDowntime(e.target.value)}
            placeholder="min"
            className="w-16 min-w-0 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              border:
                variant === "light"
                  ? "1px solid rgba(255,255,255,0.22)"
                  : "1px solid var(--border)",
            }}
          />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="post-mortem (optional)"
            className="min-w-0 flex-1 rounded-[var(--radius-sub)] bg-transparent px-2 py-1.5 outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "#ffffff" : "var(--fg)",
              border:
                variant === "light"
                  ? "1px solid rgba(255,255,255,0.22)"
                  : "1px solid var(--border)",
            }}
          />
          <button
            type="button"
            onClick={logIncident}
            disabled={!Number.isFinite(Number(downtime))}
            className="shrink-0 rounded-[var(--radius-sub)] px-3 py-1.5 font-bold uppercase transition-opacity disabled:opacity-40"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.4px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color:
                variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Log
          </button>
        </div>

        <ul
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {entries
            .slice()
            .reverse()
            .map((e) => {
              const v = e.value || {};
              return (
                <li
                  key={e.ts}
                  className="group flex items-center gap-2 rounded-[var(--radius-sub)] px-1.5 py-1"
                  style={{
                    background:
                      variant === "light"
                        ? "rgba(255,255,255,0.06)"
                        : "var(--card-alt)",
                  }}
                >
                  <span className="shrink-0 font-semibold">
                    {fullDate(e.ts)}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.4px",
                      background:
                        severityTone(v.severity, variant).background,
                      color: severityTone(v.severity, variant).color,
                    }}
                  >
                    {v.severity || "—"}
                  </span>
                  <span
                    style={{
                      color:
                        variant === "light"
                          ? "rgba(255,255,255,0.85)"
                          : "var(--fg)",
                    }}
                  >
                    {Number.isFinite(v.downtime) ? `${v.downtime}m` : "—"}
                  </span>
                  {v.link ? (
                    <a
                      href={v.link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 truncate underline-offset-2 hover:underline"
                      style={{
                        color:
                          variant === "light"
                            ? "rgba(255,255,255,0.7)"
                            : "var(--muted-fg)",
                      }}
                      title={v.link}
                    >
                      post-mortem ↗
                    </a>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <button
                    type="button"
                    onClick={() => remove(e.ts)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      fontSize: 10,
                      color:
                        variant === "light"
                          ? "rgba(255,255,255,0.5)"
                          : "var(--dim-fg)",
                    }}
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
        </ul>
      </div>
    </WidgetShell>
  );
}

const SEVERITY_LEVELS = ["P1", "P2", "P3", "P4"];

/**
 * Headline mode 1 — a budget is set:
 *
 *     43 / 60 min consumed
 *     [████████░░░░░░] 71%
 *     · 4 incidents · MTTR 11m
 *
 * Mode 2 — no budget, no period:
 *
 *     Σ 43m
 *     4 incidents · MTTR 11m
 *
 * The MTTR rounds to the nearest minute — sub-minute precision is
 * noise for outage tracking.
 */
function Headline({ totals, budget, unit, period, variant }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const monoStyle = {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: muted,
    lineHeight: 1.4,
  };

  if (Number.isFinite(budget) && budget > 0) {
    const pct = Math.min(
      100,
      Math.round((totals.totalDowntime / budget) * 100),
    );
    const over = totals.totalDowntime > budget;
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 40,
              letterSpacing: "-1.4px",
              color: over
                ? variant === "light"
                  ? "#ffd5d5"
                  : "var(--danger)"
                : "inherit",
            }}
          >
            {totals.totalDowntime}
          </div>
          <div style={monoStyle}>
            / {budget} {unit}
            {period ? ` · ${period}` : ""}
          </div>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light"
                ? "rgba(255,255,255,0.18)"
                : "var(--border)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${pct}%`,
              background: over
                ? variant === "light"
                  ? "#ffd5d5"
                  : "var(--danger)"
                : variant === "light"
                  ? "#ffffff"
                  : "var(--accent)",
            }}
          />
        </div>
        <div style={monoStyle}>
          {totals.count} incident{totals.count === 1 ? "" : "s"}
          {totals.count > 0
            ? ` · MTTR ${Math.round(totals.mttr)}${unit === "minutes" ? "m" : ""}`
            : ""}
          {over ? " · over budget" : ""}
        </div>
      </div>
    );
  }

  // No budget set — fall back to a plain total.
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <div
          className="font-semibold leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 40,
            letterSpacing: "-1.4px",
          }}
        >
          Σ {totals.totalDowntime}
        </div>
        <div style={monoStyle}>{unit}</div>
      </div>
      <div style={monoStyle}>
        {totals.count} incident{totals.count === 1 ? "" : "s"}
        {totals.count > 0
          ? ` · MTTR ${Math.round(totals.mttr)}${unit === "minutes" ? "m" : ""}`
          : ""}
      </div>
    </div>
  );
}

function SeverityRow({ distribution, variant }) {
  return (
    <div
      className="flex items-center gap-1.5"
      style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
    >
      {distribution.map(([sev, count]) => {
        const tone = severityTone(sev, variant);
        return (
          <span
            key={sev}
            className="rounded-full px-1.5 py-0.5"
            style={{
              background: tone.background,
              color: tone.color,
              letterSpacing: "0.4px",
            }}
          >
            {sev} · {count}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Tone helper — P1 reads warm/red, P4 cool/muted. Keeps the chip
 * styling consistent between the inline log row and the distribution
 * row up top. Dark + light variants of the dashboard each get their
 * own palette so contrast stays readable.
 */
function severityTone(sev, variant) {
  const light = variant === "light";
  switch (sev) {
    case "P1":
      return {
        background: light ? "rgba(255,180,180,0.35)" : "rgba(220,80,80,0.18)",
        color: light ? "#ffe1e1" : "#e08585",
      };
    case "P2":
      return {
        background: light ? "rgba(255,210,150,0.32)" : "rgba(220,150,80,0.18)",
        color: light ? "#ffead0" : "#e0b075",
      };
    case "P3":
      return {
        background: light ? "rgba(220,220,220,0.28)" : "rgba(160,160,160,0.18)",
        color: light ? "rgba(255,255,255,0.85)" : "var(--muted-fg)",
      };
    default:
      return {
        background: light ? "rgba(255,255,255,0.14)" : "rgba(200,200,200,0.1)",
        color: light ? "rgba(255,255,255,0.7)" : "var(--dim-fg)",
      };
  }
}

/**
 * Reduce entries to summary numbers.
 *
 * `bySeverity` is an array of `[severity, count]` so the renderer can
 * preserve insertion order (P1 → P4 by SEVERITY_LEVELS order). A Map
 * would also work but the renderer needs an iterable anyway.
 */
function computeTotals(entries) {
  let totalDowntime = 0;
  const severityCount = new Map();
  let count = 0;
  for (const e of entries) {
    const v = e.value || {};
    const d = Number(v.downtime);
    if (Number.isFinite(d) && d >= 0) totalDowntime += d;
    count += 1;
    const sev = typeof v.severity === "string" ? v.severity : "—";
    severityCount.set(sev, (severityCount.get(sev) || 0) + 1);
  }
  const mttr = count > 0 ? totalDowntime / count : 0;
  // Sort severities by SEVERITY_LEVELS order, dropping unknown sevs to
  // the end so the chip strip reads P1 → P4 → "—" consistently.
  const bySeverity = [];
  for (const lvl of SEVERITY_LEVELS) {
    if (severityCount.has(lvl)) bySeverity.push([lvl, severityCount.get(lvl)]);
  }
  for (const [sev, n] of severityCount) {
    if (!SEVERITY_LEVELS.includes(sev)) bySeverity.push([sev, n]);
  }
  return { totalDowntime, count, mttr, bySeverity };
}

/**
 * Filter entries to the current cadence window so "budget consumed"
 * resets between periods. `quarterly` → 90d, `monthly` → 30d, etc.
 * Unknown / non-bucketable periods (per-incident, milestone,
 * continuous) return the full array — the widget surfaces all-time
 * totals in that case.
 *
 * Day counts are deliberately approximate (quarterly = 90d, not
 * "rolling quarter aligned to calendar"). The user can refine later;
 * for MVP-grade tracking this matches the granularity the COUNTER
 * widget uses for its weekly-bar fallback.
 */
function filterByPeriod(entries, period) {
  const days = periodToDays(period);
  if (!days) return entries;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return entries.filter((e) => e.ts >= cutoff);
}

function periodToDays(period) {
  if (typeof period !== "string") return 0;
  switch (period.toLowerCase()) {
    case "daily":
    case "day":
      return 1;
    case "weekly":
    case "week":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
    case "month":
      return 30;
    case "quarterly":
    case "quarter":
      return 90;
    default:
      return 0;
  }
}
