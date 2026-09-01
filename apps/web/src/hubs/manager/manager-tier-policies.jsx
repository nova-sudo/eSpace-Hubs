"use client";

/**
 * Manager Hub — tier policies. Renders at /[hub]/tier-policies.
 *
 * Lets a manager author the achievement-tier CRITERIA (not a grade) for a
 * Goal Code — org-wide, applying to every developer whose goal (L1 or L2)
 * shares that code. An L2 code takes precedence over its parent L1's code,
 * per field, so a manager can set a broad L1 policy and then override just
 * one L2 underneath it. Two independent ladders per code:
 *   - Final tiers    — the whole-goal ladder (spec.tiers today)
 *   - Cadence tiers   — the per-cadence-window ladder (e.g. per quarter)
 * Either may be set alone; neither is graded against or derived from the
 * other. A goal with nothing set here falls back to its own AI-extracted
 * or self-authored tiers, unchanged.
 *
 * Data: GET/PUT/DELETE /api/v1/manager/tier-policies[/:code].
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPut } from "@/lib/api-client";
import { Button, Field, Input, MonoLabel, PageHeader } from "@/components/ui";

const TIER_ORDER = ["notAchieved", "achieved", "overAchieved", "roleModel"];
const TIER_LABELS = {
  notAchieved: "Not achieved",
  achieved: "Achieved",
  overAchieved: "Over achieved",
  roleModel: "Role model",
};

function emptyLadder() {
  return { notAchieved: "", achieved: "", overAchieved: "", roleModel: "" };
}

function ladderFromPolicy(criteria) {
  const c = criteria || {};
  return {
    notAchieved: c.notAchieved || "",
    achieved: c.achieved || "",
    overAchieved: c.overAchieved || "",
    roleModel: c.roleModel || "",
  };
}

/** null when every rung is blank (nothing to send / clears the field). */
function ladderToPayload(ladder) {
  const hasAny = TIER_ORDER.some((k) => ladder[k].trim());
  if (!hasAny) return null;
  const out = {};
  for (const k of TIER_ORDER) out[k] = ladder[k].trim() || null;
  return out;
}

/** The row's identity — one policy per (code, cycle); "legacy" = pre-F6. */
function policyKey(p) {
  return `${p.code}::${p.cycleKey ?? "legacy"}`;
}

export function ManagerTierPolicies() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState(null);
  const [newCode, setNewCode] = useState("");
  // F6 — the codes that actually exist in the org, with blast radius.
  // Feeds the picker and the per-row "affects N goals · M people" chip.
  const [codes, setCodes] = useState(null);
  const currentCycle = String(new Date().getFullYear());

  async function reload() {
    const [r, rc] = await Promise.all([
      apiGet("/manager/tier-policies"),
      apiGet("/manager/goal-codes"),
    ]);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't load tier policies.");
      setLoading(false);
      return;
    }
    setPolicies(r.data?.policies ?? []);
    if (rc.ok) setCodes(rc.data?.codes ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  function applyUpdate(policy) {
    setPolicies((prev) => {
      const idx = prev.findIndex((p) => policyKey(p) === policyKey(policy));
      if (idx < 0) return [...prev, policy].sort((a, b) => a.code.localeCompare(b.code));
      const next = [...prev];
      next[idx] = policy;
      return next;
    });
  }

  function applyDelete(policy) {
    setPolicies((prev) => prev.filter((p) => policyKey(p) !== policyKey(policy)));
  }

  function addCode(code) {
    const trimmed = code.trim();
    if (!trimmed) return;
    const draft = {
      code: trimmed,
      cycleKey: currentCycle,
      finalTiers: null,
      cadenceTiers: null,
      updatedAt: null,
    };
    const existing = policies.find((p) => policyKey(p) === policyKey(draft));
    if (existing) {
      setOpenKey(policyKey(existing));
      setNewCode("");
      return;
    }
    setPolicies((prev) =>
      [...prev, draft].sort((a, b) => a.code.localeCompare(b.code)),
    );
    setOpenKey(policyKey(draft));
    setNewCode("");
  }

  function handleAdd(e) {
    e.preventDefault();
    addCode(newCode);
  }

  // Picker rows: real codes not yet governed for the current cycle,
  // filtered by whatever's typed. The free-text path stays as an escape
  // hatch (a code no tree carries YET), but it's labeled as governing
  // nobody instead of failing silently.
  const governedKeys = new Set(policies.map((p) => policyKey(p)));
  const filter = newCode.trim().toLowerCase();
  const pickerRows = (codes || [])
    .filter((c) => !governedKeys.has(`${c.code}::${currentCycle}`))
    .filter(
      (c) =>
        !filter ||
        c.code.toLowerCase().includes(filter) ||
        (c.title || "").toLowerCase().includes(filter),
    )
    .slice(0, 8);
  const typedMatchesExisting = (codes || []).some(
    (c) => c.code.toLowerCase() === filter,
  );

  return (
    <main className="relative z-[2] mx-auto max-w-4xl px-10 pb-14 pt-9">
      <PageHeader
        crumb="Manager · achievement-tier governance"
        title="Set tiers by Goal Code."
        italicWord="Goal Code"
        subtitle={
          <>
            Author the Final (whole-goal) and Per-Cadence (per-window)
            achievement-tier ladders for a Goal Code (L1 or L2) — it applies
            to every developer whose goal carries that code. An L2 code
            overrides its parent L1's code, field by field. A goal with
            nothing set here keeps using its own AI-extracted or
            self-authored tiers. Policies are scoped to a performance
            cycle (year) — this year's criteria never silently grade next
            year's goals — and affected engineers are notified on save.
          </>
        }
      />

      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={handleAdd}
      >
        <Field
          label={`Goal Code — governs cycle ${currentCycle}`}
          className="flex-1 min-w-[200px]"
        >
          <Input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder={codes === null ? "Loading codes…" : "Filter existing codes, or type one"}
            mono
          />
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={!newCode.trim()}>
          + Govern code
        </Button>
      </form>

      {/* The picker: codes that actually exist, with their blast radius —
          the honest replacement for a free-text field where a typo
          governed nobody, silently. */}
      {pickerRows.length > 0 ? (
        <div className="mt-2 flex flex-col overflow-hidden rounded-[var(--radius-sub)] border border-border">
          {pickerRows.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => addCode(c.code)}
              className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent-dim/25"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <code
                  className="shrink-0 text-accent"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}
                >
                  {c.code}
                </code>
                <span className="truncate text-muted-fg" style={{ fontSize: 11.5 }}>
                  {c.title}
                </span>
              </span>
              <span
                className="shrink-0 text-dim-fg"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              >
                {c.level} · {c.goals} goal{c.goals === 1 ? "" : "s"} · {c.people}{" "}
                {c.people === 1 ? "person" : "people"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {codes !== null && filter && pickerRows.length === 0 && !typedMatchesExisting ? (
        <p
          className="mt-2 text-[11.5px] leading-[1.5]"
          style={{ color: "var(--warn)" }}
        >
          No goal in the org carries “{newCode.trim()}”. You can still govern
          it, but it applies to nobody until a goal tree carries that code.
        </p>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <div
            className="text-muted-fg"
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
          >
            Loading…
          </div>
        ) : policies.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card p-6 text-[13px] leading-[1.6] text-muted-fg">
            No tier policies yet. Add a Goal Code above to start governing it.
          </div>
        ) : (
          <>
            <MonoLabel>
              {policies.length} code{policies.length === 1 ? "" : "s"} governed
            </MonoLabel>
            <div className="mt-3 flex flex-col gap-2">
              {policies.map((p) => (
                <PolicyRow
                  key={policyKey(p)}
                  policy={p}
                  scope={(codes || []).find((c) => c.code === p.code) || null}
                  expanded={openKey === policyKey(p)}
                  onExpand={() =>
                    setOpenKey(openKey === policyKey(p) ? null : policyKey(p))
                  }
                  onUpdate={applyUpdate}
                  onDelete={applyDelete}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function PolicyRow({ policy, scope, expanded, onExpand, onUpdate, onDelete }) {
  return (
    <div
      className="rounded-[var(--radius-tile)] border bg-card"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-accent-dim/20"
      >
        <div className="flex flex-1 items-baseline gap-3">
          <code
            className="font-semibold text-accent"
            style={{ fontFamily: "var(--font-mono)", fontSize: 13, letterSpacing: "0.3px" }}
          >
            {policy.code}
          </code>
          <span
            className="shrink-0 rounded-full px-1.5 py-[1px] uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.4px",
              background: policy.cycleKey ? "var(--accent-dim)" : "var(--panel-2)",
              color: policy.cycleKey ? "var(--accent)" : "var(--muted-fg)",
            }}
            title={
              policy.cycleKey
                ? `Governs the ${policy.cycleKey} cycle only.`
                : "Authored before cycle scoping — applies to ANY cycle until re-saved (a cycle-scoped policy on the same code outranks it)."
            }
          >
            {policy.cycleKey || "any cycle"}
          </span>
          {/* The blast radius — who this row actually governs. Zero is a
              warning, not silence: a policy matching nothing is either a
              typo or a stale code. */}
          <span
            className="shrink-0"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: scope && scope.goals > 0 ? "var(--dim-fg)" : "var(--warn)",
            }}
          >
            {scope && scope.goals > 0
              ? `affects ${scope.goals} goal${scope.goals === 1 ? "" : "s"} · ${scope.people} ${scope.people === 1 ? "person" : "people"}`
              : "matches no goals"}
          </span>
          {policy.finalTiers ? (
            <span
              className="text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              final set
            </span>
          ) : null}
          {policy.cadenceTiers ? (
            <span
              className="text-muted-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              cadence set
            </span>
          ) : null}
        </div>
        <span
          className="text-dim-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
        >
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <PolicyEditor policy={policy} onUpdate={onUpdate} onDelete={onDelete} />
      ) : null}
    </div>
  );
}

function PolicyEditor({ policy, onUpdate, onDelete }) {
  const [finalTiers, setFinalTiers] = useState(() =>
    ladderFromPolicy(policy.finalTiers),
  );
  const [cadenceTiers, setCadenceTiers] = useState(() =>
    ladderFromPolicy(policy.cadenceTiers),
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    // A legacy (unscoped) row re-saves as a scoped row for the current
    // cycle — re-touching a policy is exactly when its author confirms
    // which year it's meant for.
    const cycleKey = policy.cycleKey || String(new Date().getFullYear());
    const r = await apiPut(`/manager/tier-policies/${encodeURIComponent(policy.code)}`, {
      cycleKey,
      finalTiers: ladderToPayload(finalTiers),
      cadenceTiers: ladderToPayload(cadenceTiers),
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't save tier policy.");
      return;
    }
    if (!policy.cycleKey) {
      // Migration on touch: the save above wrote a cycle-scoped row; the
      // old unscoped row would otherwise keep governing every OTHER
      // cycle with the stale ladder. Remove it — re-saving IS the
      // author's confirmation of scope.
      void apiDelete(
        `/manager/tier-policies/${encodeURIComponent(policy.code)}?cycleKey=legacy`,
      );
      onDelete(policy);
    }
    onUpdate(r.data?.policy);
    toast.success(`Saved ${cycleKey} tiers for "${policy.code}". Affected engineers are notified.`);
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Remove the ${policy.cycleKey || "any-cycle"} tier policy for "${policy.code}"?\n\nMatching goals fall back to their own AI-extracted or self-authored tiers again.`,
      )
    ) {
      return;
    }
    setSaving(true);
    const r = await apiDelete(
      `/manager/tier-policies/${encodeURIComponent(policy.code)}?cycleKey=${encodeURIComponent(policy.cycleKey || "legacy")}`,
    );
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't remove tier policy.");
      return;
    }
    onDelete(policy);
    toast.success(`Removed tier policy for "${policy.code}".`);
  }

  return (
    <div className="border-t px-5 py-5" style={{ borderColor: "var(--border)" }}>
      <div className="grid grid-cols-2 gap-6">
        <Ladder
          title="Final tiers"
          hint="The whole-goal ladder — pooled across every submitted period."
          ladder={finalTiers}
          onChange={setFinalTiers}
          disabled={saving}
        />
        <Ladder
          title="Per-cadence tiers"
          hint="Graded once per cadence window (e.g. one quarter on its own)."
          ladder={cadenceTiers}
          onChange={setCadenceTiers}
          disabled={saving}
        />
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={saving}>
          Remove policy
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function Ladder({ title, hint, ladder, onChange, disabled }) {
  return (
    <div>
      <div
        className="uppercase tracking-[0.5px]"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-fg)" }}
      >
        {title}
      </div>
      <p className="mt-1 text-muted-fg" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
        {hint}
      </p>
      <div className="mt-2 flex flex-col gap-2.5">
        {TIER_ORDER.map((k) => (
          <Field key={k} label={TIER_LABELS[k]}>
            <textarea
              rows={2}
              value={ladder[k]}
              onChange={(e) => onChange({ ...ladder, [k]: e.target.value })}
              disabled={disabled}
              className="w-full rounded-[var(--radius-sub)] border border-border bg-card px-3 py-2 text-[12.5px] text-fg outline-none placeholder:text-dim-fg focus:border-accent"
              style={{ fontFamily: "var(--font-sans)", resize: "vertical" }}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}
