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

export function ManagerTierPolicies() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openCode, setOpenCode] = useState(null);
  const [newCode, setNewCode] = useState("");

  async function reload() {
    const r = await apiGet("/manager/tier-policies");
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't load tier policies.");
      setLoading(false);
      return;
    }
    setPolicies(r.data?.policies ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  function applyUpdate(policy) {
    setPolicies((prev) => {
      const idx = prev.findIndex((p) => p.code === policy.code);
      if (idx < 0) return [...prev, policy].sort((a, b) => a.code.localeCompare(b.code));
      const next = [...prev];
      next[idx] = policy;
      return next;
    });
  }

  function applyDelete(code) {
    setPolicies((prev) => prev.filter((p) => p.code !== code));
  }

  function handleAdd(e) {
    e.preventDefault();
    const code = newCode.trim();
    if (!code) return;
    if (policies.some((p) => p.code === code)) {
      setOpenCode(code);
      setNewCode("");
      return;
    }
    setPolicies((prev) =>
      [...prev, { code, finalTiers: null, cadenceTiers: null, updatedAt: null }].sort(
        (a, b) => a.code.localeCompare(b.code),
      ),
    );
    setOpenCode(code);
    setNewCode("");
  }

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
            self-authored tiers.
          </>
        }
      />

      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={handleAdd}
      >
        <Field label="Goal Code (L1 or L2)" className="flex-1 min-w-[200px]">
          <Input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="R-L0-3-PSCS-L1-06 or …-L2-06-01"
            mono
          />
        </Field>
        <Button type="submit" variant="primary" size="sm" disabled={!newCode.trim()}>
          + Add code
        </Button>
      </form>

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
                  key={p.code}
                  policy={p}
                  expanded={openCode === p.code}
                  onExpand={() => setOpenCode(openCode === p.code ? null : p.code)}
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

function PolicyRow({ policy, expanded, onExpand, onUpdate, onDelete }) {
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
    const r = await apiPut(`/manager/tier-policies/${encodeURIComponent(policy.code)}`, {
      finalTiers: ladderToPayload(finalTiers),
      cadenceTiers: ladderToPayload(cadenceTiers),
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't save tier policy.");
      return;
    }
    onUpdate(r.data?.policy);
    toast.success(`Saved tiers for "${policy.code}".`);
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Remove the tier policy for "${policy.code}"?\n\nMatching goals fall back to their own AI-extracted or self-authored tiers again.`,
      )
    ) {
      return;
    }
    setSaving(true);
    const r = await apiDelete(`/manager/tier-policies/${encodeURIComponent(policy.code)}`);
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't remove tier policy.");
      return;
    }
    onDelete(policy.code);
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
