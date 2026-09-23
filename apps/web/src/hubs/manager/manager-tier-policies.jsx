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
 * The layout is a rail plus a compare area that holds TWO codes open at
 * once. Authoring a ladder is a comparison act — "Achieved" for DP-L0-2
 * and for R-L0-3 differ by one word, and an accordion that opens one row
 * at a time made that impossible to see. A code governing zero goals is
 * flagged in the rail, where you choose, rather than after you open it.
 *
 * Data: GET/PUT/DELETE /api/v1/manager/tier-policies[/:code].
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { apiDelete, apiGet, apiPut } from "@/lib/api-client";
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Input,
  Label,
  PageHeader,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "./confirm-dialog";
import { EmptyCard } from "./manager-ui";
import { plural } from "./manager-format";

const TIER_ORDER = ["notAchieved", "achieved", "overAchieved", "roleModel"];
const TIER_LABELS = {
  notAchieved: "Not achieved",
  achieved: "Achieved",
  overAchieved: "Over achieved",
  roleModel: "Role model",
};
const TIER_TONE = {
  notAchieved: "peach",
  achieved: "mint",
  overAchieved: "sky",
  roleModel: "lav",
};

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

export function ManagerTierPolicies({ embedded = false }) {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  // Up to two codes open side by side — the whole point of the layout.
  const [openKeys, setOpenKeys] = useState([]);
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

  function openPolicy(key) {
    setOpenKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // Two at a time: the newest pick pushes out the older one.
      return [...prev, key].slice(-2);
    });
  }

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
    setOpenKeys((prev) => prev.filter((k) => k !== policyKey(policy)));
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
      openPolicy(policyKey(existing));
      setNewCode("");
      return;
    }
    setPolicies((prev) => [...prev, draft].sort((a, b) => a.code.localeCompare(b.code)));
    setOpenKeys((prev) => [...prev.filter((k) => k !== policyKey(draft)), policyKey(draft)].slice(-2));
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

  const open = openKeys
    .map((k) => policies.find((p) => policyKey(p) === k))
    .filter(Boolean);

  return (
    <Wrapper embedded={embedded}>
      {embedded ? null : <PageHeader
        crumb="Manager · achievement-tier governance"
        title="Set tiers by Goal Code."
        subtitle={
          <>
            Author the Final (whole-goal) and Per-Cadence (per-window)
            achievement-tier ladders for a Goal Code (L1 or L2) — it applies
            to every developer whose goal carries that code. An L2 code
            overrides its parent L1&apos;s code, field by field. A goal with
            nothing set here keeps using its own AI-extracted or
            self-authored tiers. Policies are scoped to a performance
            cycle (year) — this year&apos;s criteria never silently grade next
            year&apos;s goals — and affected engineers are notified on save.
          </>
        }
      />}

      <form className="flex flex-wrap items-end gap-2" onSubmit={handleAdd}>
        <Field
          label={`Goal Code — governs cycle ${currentCycle}`}
          className="min-w-[200px] flex-1"
        >
          <Input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder={
              codes === null ? "Loading codes…" : "Filter existing codes, or type one"
            }
            className="font-mono"
          />
        </Field>
        <Button type="submit" variant="ink" size="sm" disabled={!newCode.trim()}>
          + Govern code
        </Button>
      </form>

      {/* The picker: codes that actually exist, with their blast radius —
          the honest replacement for a free-text field where a typo
          governed nobody, silently. */}
      {pickerRows.length > 0 ? (
        <div className="mt-2 flex flex-col overflow-hidden rounded-[var(--radius-lg)] bg-card-alt">
          {pickerRows.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => addCode(c.code)}
              className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-card"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <code className="shrink-0 font-mono text-[11.5px] font-bold text-fg">
                  {c.code}
                </code>
                <span className="truncate text-[11.5px] text-muted-fg">{c.title}</span>
              </span>
              <span className="shrink-0 text-[11px] text-dim-fg">
                {c.level} · {plural(c.goals, "goal", "goals")} ·{" "}
                {plural(c.people, "person", "people")}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {codes !== null && filter && pickerRows.length === 0 && !typedMatchesExisting ? (
        <div className="mt-2 rounded-[var(--radius-lg)] bg-lemon p-3 text-[11.5px] leading-[1.5] text-lemon-ink">
          No goal in the org carries “{newCode.trim()}”. You can still govern
          it, but it applies to nobody until a goal tree carries that code.
        </div>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <EmptyCard>Loading…</EmptyCard>
        ) : policies.length === 0 ? (
          <EmptyCard>
            No tier policies yet. Add a Goal Code above to start governing it.
          </EmptyCard>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Card padding={11}>
              <Label className="mb-2 block px-2">
                {plural(policies.length, "code", "codes")} governed
              </Label>
              {policies.map((p) => {
                const key = policyKey(p);
                const scope = (codes || []).find((c) => c.code === p.code) || null;
                const active = openKeys.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => openPolicy(key)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[var(--radius-lg)] px-2.5 py-2 text-left transition-colors",
                      active ? "bg-card-alt" : "hover:bg-card-alt",
                    )}
                  >
                    <code className="shrink-0 font-mono text-[12px] font-bold text-fg">
                      {p.code}
                    </code>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted-fg">
                      {scope?.title || p.cycleKey || "any cycle"}
                    </span>
                    {/* The blast radius — who this row actually governs.
                        Zero is a warning, not silence: a policy matching
                        nothing is either a typo or a stale code. */}
                    {scope && scope.goals > 0 ? (
                      <span className="shrink-0 text-[11px] tabular-nums text-dim-fg">
                        {scope.goals}g · {scope.people}p
                      </span>
                    ) : (
                      <Badge tone="lemon">0 goals</Badge>
                    )}
                  </button>
                );
              })}
            </Card>

            {open.length === 0 ? (
              <EmptyCard>
                Pick a code on the left to author its ladders. Pick a second to
                hold both open and compare them word for word.
              </EmptyCard>
            ) : (
              <div
                className={cn(
                  "grid gap-3",
                  open.length > 1 ? "xl:grid-cols-2" : "grid-cols-1",
                )}
              >
                {open.map((p) => (
                  <PolicyEditor
                    key={policyKey(p)}
                    policy={p}
                    scope={(codes || []).find((c) => c.code === p.code) || null}
                    onClose={() => openPolicy(policyKey(p))}
                    onUpdate={applyUpdate}
                    onDelete={applyDelete}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

function PolicyEditor({ policy, scope, onClose, onUpdate, onDelete }) {
  const [finalTiers, setFinalTiers] = useState(() => ladderFromPolicy(policy.finalTiers));
  const [cadenceTiers, setCadenceTiers] = useState(() =>
    ladderFromPolicy(policy.cadenceTiers),
  );
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
    toast.success(
      `Saved ${cycleKey} tiers for "${policy.code}". Affected engineers are notified.`,
    );
  }

  async function handleDelete() {
    setSaving(true);
    const r = await apiDelete(
      `/manager/tier-policies/${encodeURIComponent(policy.code)}?cycleKey=${encodeURIComponent(
        policy.cycleKey || "legacy",
      )}`,
    );
    setSaving(false);
    setConfirmOpen(false);
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't remove tier policy.");
      return;
    }
    onDelete(policy);
    toast.success(`Removed tier policy for "${policy.code}".`);
  }

  return (
    <Card padding={18}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-[13px] font-bold text-fg">{policy.code}</code>
        <Badge tone="lav">{policy.cycleKey || "any cycle"}</Badge>
        <span className="flex-1" />
        {scope && scope.goals > 0 ? (
          <Badge>
            {plural(scope.goals, "goal", "goals")} ·{" "}
            {plural(scope.people, "person", "people")}
          </Badge>
        ) : (
          <Badge tone="lemon">matches no goals</Badge>
        )}
        <IconButton label="Close this code" size="sm" onCard onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {scope?.title ? (
        <div className="mt-1 text-[12px] text-muted-fg">{scope.title}</div>
      ) : null}

      <div className="mt-4 grid gap-5">
        <Ladder
          title="Whole goal"
          hint="The whole-goal ladder — pooled across every submitted period."
          ladder={finalTiers}
          onChange={setFinalTiers}
          disabled={saving}
        />
        <Ladder
          title="Per window"
          hint="Graded once per cadence window (e.g. one quarter on its own)."
          ladder={cadenceTiers}
          onChange={setCadenceTiers}
          disabled={saving}
        />
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={saving}
        >
          Remove policy
        </Button>
        <Button type="button" variant="ink" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        busy={saving}
        title={`Remove the ${policy.cycleKey || "any-cycle"} policy for ${policy.code}?`}
        body="Matching goals fall back to their own AI-extracted or self-authored tiers again."
        confirmLabel="Remove policy"
        onConfirm={handleDelete}
        onClose={() => setConfirmOpen(false)}
      />
    </Card>
  );
}

function Ladder({ title, hint, ladder, onChange, disabled }) {
  return (
    <div>
      <Label>{title}</Label>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-muted-fg">{hint}</p>
      <div className="mt-2 flex flex-col gap-2.5">
        {TIER_ORDER.map((k) => (
          <div key={k}>
            <Badge tone={TIER_TONE[k]} className="mb-1.5">
              {TIER_LABELS[k]}
            </Badge>
            <textarea
              rows={2}
              aria-label={`${title} · ${TIER_LABELS[k]}`}
              value={ladder[k]}
              onChange={(e) => onChange({ ...ladder, [k]: e.target.value })}
              disabled={disabled}
              className="w-full rounded-[var(--radius-lg)] bg-card-alt px-3.5 py-2.5 text-[12.5px] text-fg outline-none placeholder:text-dim-fg focus:ring-2 focus:ring-ink"
              style={{ resize: "vertical" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Standalone: the page's own <main>. Embedded (the "Tier policies" tab of
 * Goals & policies): the host page owns <main> and the header.
 */
function Wrapper({ embedded, children }) {
  if (embedded) return <div>{children}</div>;
  return <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">{children}</main>;
}
