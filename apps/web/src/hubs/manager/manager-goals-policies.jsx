"use client";

/**
 * Manager Hub — Goals & policies. Renders at /[hub]/tier-policies (the
 * slot id and URL keep their old name: stored hub configs reference them).
 *
 * Two tabs, `?tab=shared|policies`:
 *   - Shared goals  author a goal once, assign it to people (they fill it
 *                   in their own goal tree), share its analytics with
 *                   viewers, and watch who filled what and when.
 *   - Tier policies the existing Goal Code tier-ladder governance, unchanged.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button, Card, PageHeader, SegmentedControl } from "@/components/ui";
import {
  AssignedGoalEditor,
  AssignedGoalProgress,
  SharedGoalsList,
  archiveAssignedGoal,
  useAssignedProgress,
  useCreatedAssignedGoals,
} from "@/features/assigned-goals";
import { apiGet } from "@/lib/api-client";
import { ConfirmDialog } from "./confirm-dialog";
import { ManagerTierPolicies } from "./manager-tier-policies";

const TABS = [
  { value: "shared", label: "Shared goals" },
  { value: "policies", label: "Tier policies" },
];

export function ManagerGoalsPolicies() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === "policies" ? "policies" : "shared";

  function setTab(next) {
    const q = new URLSearchParams(params.toString());
    q.set("tab", next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-7 sm:px-10">
      <PageHeader
        crumb="Manager · goals & policies"
        title="Goals & policies."
        subtitle={
          tab === "shared"
            ? "Share one goal with the people who should fill it, and see who's on time, who's late and who hasn't started."
            : "Author the achievement-tier ladders that grade every goal carrying a Goal Code. Policies are scoped to a cycle, and affected people are notified on save."
        }
        right={<SegmentedControl options={TABS} value={tab} onChange={setTab} />}
      />
      {tab === "policies" ? <ManagerTierPolicies embedded /> : <SharedGoalsTab />}
    </main>
  );
}

function SharedGoalsTab() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const { goals, loading, error } = useCreatedAssignedGoals({ includeArchived });
  const [selectedId, setSelectedId] = useState(null);
  // null | { mode: "new" } | { mode: "edit", goal }
  const [editor, setEditor] = useState(null);
  const [tierCodes, setTierCodes] = useState([]);

  useEffect(() => {
    void apiGet("/manager/tier-policies").then((r) => {
      if (r.ok) setTierCodes((r.data?.policies ?? []).map((p) => p.code));
    });
  }, []);

  // Select the newest goal once the list lands.
  useEffect(() => {
    if (!selectedId && goals.length > 0) setSelectedId(goals[0].id);
  }, [goals, selectedId]);

  if (editor) {
    return (
      <AssignedGoalEditor
        initial={editor.mode === "edit" ? editor.goal : null}
        tierCodes={tierCodes}
        onCancel={() => setEditor(null)}
        onDone={(goal) => {
          setEditor(null);
          if (goal?.id) setSelectedId(goal.id);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          options={[
            { value: "active", label: "Active" },
            { value: "all", label: "Include archived" },
          ]}
          value={includeArchived ? "all" : "active"}
          onChange={(v) => setIncludeArchived(v === "all")}
        />
        <Button type="button" variant="ink" onClick={() => setEditor({ mode: "new" })}>
          <Plus size={16} /> New shared goal
        </Button>
      </div>

      {error ? (
        <Card>
          <div className="text-[15px] font-bold">Couldn&apos;t load shared goals</div>
          <div className="mt-1 text-[13px] text-muted-fg">{error.message}</div>
        </Card>
      ) : loading && goals.length === 0 ? (
        <Card>
          <div className="text-[13px] text-muted-fg">Loading…</div>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[360px_1fr]">
          <SharedGoalsList
            goals={goals}
            selectedId={selectedId}
            onSelect={(g) => setSelectedId(g.id)}
            empty={
              <div>
                <div className="text-[15px] font-bold">No shared goals yet</div>
                <div className="mt-1 text-[13px] text-muted-fg">
                  Create one to give a group of people the same thing to fill in
                  — a weekly update, a monthly checklist — and track it here.
                </div>
              </div>
            }
          />
          {selectedId ? (
            <SelectedGoal
              id={selectedId}
              onEdit={(goal) => setEditor({ mode: "edit", goal })}
              onArchived={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function SelectedGoal({ id, onEdit, onArchived }) {
  const { progress } = useAssignedProgress(id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const goal = progress?.goal;
  const active = goal?.status === "active";

  const actions =
    goal && active && progress.role === "creator" ? (
      <div className="flex shrink-0 gap-2">
        <Button type="button" variant="soft" size="sm" onClick={() => onEdit(goal)}>
          Edit
        </Button>
        <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)}>
          Archive
        </Button>
      </div>
    ) : null;

  return (
    <>
      <AssignedGoalProgress goalId={id} actions={actions} />
      <ConfirmDialog
        open={confirming}
        title="Archive this shared goal?"
        body="It disappears from everyone's goals and stops sending reminders. Its history and analytics stay available here under “Include archived”."
        confirmLabel="Archive"
        busy={busy}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await archiveAssignedGoal(id);
            toast.success("Shared goal archived.");
            setConfirming(false);
            onArchived?.();
          } catch (err) {
            toast.error(err?.message || "Couldn't archive the goal.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
