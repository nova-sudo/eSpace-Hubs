"use client";

/**
 * "Publish to GitHub…" — pick a repo, tick the periods, preview one issue,
 * confirm. One issue per period; rows already published are shown checked
 * and locked with their issue number. Same portal / focus-trap / Escape
 * recipe as the GradeDialog in assigned-goals.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { buildIssueBody, buildIssueTitle } from "@espace-devhub/shared/github-links";
import { Badge, Button, Checkbox, Input, Label, Select, useFocusTrap } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useRepoOptions } from "@/features/integrations";
import { resolvePeriodContent } from "@/features/goal-specs";
import { useHubLink } from "@/features/hubs";
import { publishToGithub, useGithubLinks } from "./api";
import { findLink, isActiveLink, isGithubRepoSlug, publishErrorCopy, retryMinutes } from "./link-model";

const CUSTOM = "__custom__";

/** Marker ids for the preview only — the API stamps the real ones. */
const PREVIEW_ID = "0".repeat(24);

function deliverableCount(detail) {
  return Array.isArray(detail?.deliverables) ? detail.deliverables.length : 0;
}

/** The body as GitHub will show it, minus the hidden marker on the last line. */
function previewBody({ period, goalTitle, hubUrl, goalId, periodIndex }) {
  try {
    const full = buildIssueBody({
      period,
      goalTitle,
      hubUrl,
      marker: {
        orgId: PREVIEW_ID,
        userId: PREVIEW_ID,
        goalId: goalId || "goal",
        periodIndex,
        periodKey: null,
      },
    });
    return full.split("\n").slice(0, -1).join("\n").trimEnd();
  } catch {
    return "";
  }
}

/**
 * `defaultRepo` (optional): a suggested owner/name — e.g. the repo a manager
 * named when asking for a shared goal's issues. A repo earlier periods
 * already went to still wins over it.
 */
export function PublishToGithubDialog({ open, onClose, spec, goal, defaultRepo = null }) {
  if (!open) return null;
  return <PublishDialogBody onClose={onClose} spec={spec} goal={goal} defaultRepo={defaultRepo} />;
}

function PublishDialogBody({ onClose, spec, goal, defaultRepo }) {
  const goalId = spec?.goalId || goal?.id;
  const goalTitle = goal?.title || spec?.title || "";
  const { links } = useGithubLinks(goalId);
  const repoOptions = useRepoOptions();
  const hubLink = useHubLink();

  // Periods as the tracker resolves them (label / due / deliverables), in
  // plan order — the index is what the API and the marker key on.
  const periods = useMemo(() => {
    const n = Array.isArray(spec?.composed?.periods) ? spec.composed.periods.length : 0;
    return Array.from({ length: n }, (_, i) => {
      const p = resolvePeriodContent(spec, i);
      return {
        index: i,
        label: p?.label || `Period ${i + 1}`,
        dueAt: p?.dueAt || null,
        deliverables: deliverableCount(p?.detail),
        content: p,
      };
    });
  }, [spec]);

  const githubRepos = useMemo(
    () => (repoOptions.options || []).filter(isGithubRepoSlug),
    [repoOptions.options],
  );
  const suggestedRepo = isGithubRepoSlug(defaultRepo) ? defaultRepo.trim().toLowerCase() : null;
  const existingRepo = useMemo(
    () => links.find(isActiveLink)?.repo || suggestedRepo,
    [links, suggestedRepo],
  );

  // Repo: a listed one, or free text. Prefer the repo earlier periods went to
  // so one tracker doesn't scatter across repos by accident.
  const [choice, setChoice] = useState(() => existingRepo || githubRepos[0] || CUSTOM);
  const [custom, setCustom] = useState(existingRepo && !githubRepos.includes(existingRepo) ? existingRepo : "");
  const listed = githubRepos.length > 0;
  // Options and links arrive async — adopt a default ONCE, the first time
  // there is one, and never again, so "Another repository…" stays chosen.
  const defaultedRef = useRef(Boolean(existingRepo || githubRepos[0]));
  useEffect(() => {
    if (defaultedRef.current) return;
    const next = existingRepo || githubRepos[0];
    if (!next) return;
    defaultedRef.current = true;
    if (githubRepos.includes(next)) setChoice(next);
    else setCustom(next);
  }, [githubRepos, existingRepo]);
  const repo = (choice === CUSTOM || !listed ? custom : choice).trim();
  const repoValid = isGithubRepoSlug(repo);

  // Published rows are locked; everything else starts ticked.
  const publishedBy = useMemo(() => {
    const m = new Map();
    for (const p of periods) {
      const l = findLink(links, p.index);
      if (l && isActiveLink(l)) m.set(p.index, l);
    }
    return m;
  }, [periods, links]);
  const [picked, setPicked] = useState(() => new Set(periods.map((p) => p.index)));
  const selectable = periods.filter((p) => !publishedBy.has(p.index));
  const selected = selectable.filter((p) => picked.has(p.index)).map((p) => p.index);
  const allPicked = selectable.length > 0 && selected.length === selectable.length;

  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const trapRef = useFocusTrap(true);
  const closeRef = useRef(onClose);
  const savingRef = useRef(saving);
  useEffect(() => {
    closeRef.current = onClose;
    savingRef.current = saving;
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !savingRef.current) closeRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const previewPeriod = periods.find((p) => p.index === selected[0]) || selectable[0] || periods[0] || null;
  const hubUrl =
    typeof window !== "undefined" ? `${window.location.origin}${hubLink("/goals")}` : null;
  const preview = previewPeriod
    ? {
        title: buildIssueTitle({ goalCode: goal?.code, goalTitle, periodLabel: previewPeriod.label }),
        body: previewBody({
          period: previewPeriod.content,
          goalTitle,
          hubUrl,
          goalId,
          periodIndex: previewPeriod.index,
        }),
      }
    : null;

  if (typeof document === "undefined") return null;

  function toggle(index) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirm() {
    if (saving || !repoValid || selected.length === 0) return;
    setSaving(true);
    try {
      const res = await publishToGithub({ goalId, repo, periodIndexes: selected });
      const created = Number(res?.created) || 0;
      const adopted = Number(res?.adopted) || 0;
      const remaining = Number(res?.remaining) || 0;
      if (remaining > 0) {
        toast.warning(
          `${created} of ${selected.length} created, GitHub rate-limited — try again in ${retryMinutes(res?.retryAfterMs)} min.`,
        );
      } else if (created === 0 && adopted > 0) {
        toast.success(`Linked ${adopted} existing ${adopted === 1 ? "issue" : "issues"} in ${repo}.`);
      } else {
        toast.success(
          `Created ${created} ${created === 1 ? "issue" : "issues"} in ${repo}${adopted ? ` (${adopted} already there, linked)` : ""}.`,
        );
      }
      onClose();
    } catch (err) {
      toast.error(publishErrorCopy(err));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publish to GitHub"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4 sm:p-5"
    >
      <div
        ref={trapRef}
        className="flex max-h-full w-full max-w-[600px] flex-col gap-4 overflow-y-auto rounded-[var(--radius-xl)] bg-card p-5 sm:p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div>
          <Label>{goalTitle}</Label>
          <div className="text-[18px] font-bold tracking-[-0.01em]">Publish to GitHub</div>
          <div className="mt-1 text-[13px] leading-[1.45] text-muted-fg">
            One issue per period, created with your GitHub account. Tick the task list there as
            you go; closing an issue logs that period as done here.
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label as="label" htmlFor="gh-publish-repo">
            Repository
          </Label>
          {listed ? (
            <Select
              aria-label="Repository"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              size="sm"
            >
              {githubRepos.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
              <option value={CUSTOM}>Another repository…</option>
            </Select>
          ) : null}
          {!listed || choice === CUSTOM ? (
            <Input
              id="gh-publish-repo"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="owner/name"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={custom.trim() !== "" && !isGithubRepoSlug(custom)}
              className="h-9 font-mono text-[13px]"
            />
          ) : null}
          {repoOptions.isLoading && !listed ? (
            <div className="text-[12px] text-muted-fg">Loading your repositories…</div>
          ) : null}
          {custom.trim() !== "" && !isGithubRepoSlug(custom) ? (
            <div className="text-[12px] text-peach-text">Use the owner/name form, like acme/app.</div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>
              Periods · {selected.length} of {selectable.length} selected
            </Label>
            {selectable.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPicked(allPicked ? new Set() : new Set(selectable.map((p) => p.index)))
                }
              >
                {allPicked ? "Clear" : "Select all"}
              </Button>
            ) : null}
          </div>
          <ul className="flex max-h-[260px] flex-col gap-1 overflow-y-auto rounded-[var(--radius-lg)] bg-card-alt p-2">
            {periods.map((p) => {
              const link = publishedBy.get(p.index);
              const checked = link ? true : picked.has(p.index);
              return (
                <li
                  key={p.index}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5",
                    link ? "opacity-70" : "",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={Boolean(link)}
                    onChange={() => toggle(p.index)}
                    label={p.label}
                  />
                  <button
                    type="button"
                    disabled={Boolean(link)}
                    onClick={() => toggle(p.index)}
                    className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-left disabled:cursor-default"
                  >
                    <span className="text-[13px] font-semibold text-fg">{p.label}</span>
                    {p.dueAt ? <span className="text-[12px] text-muted-fg">due {p.dueAt}</span> : null}
                    <span className="text-[12px] text-muted-fg">
                      {p.deliverables} {p.deliverables === 1 ? "deliverable" : "deliverables"}
                    </span>
                  </button>
                  {link ? (
                    <Badge tone="neutral" className="shrink-0">
                      {link.status === "pending" ? "Publishing…" : "Published"}
                      {link.issueNumber ? <span className="font-mono">#{link.issueNumber}</span> : null}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
            {periods.length === 0 ? (
              <li className="px-2 py-1.5 text-[13px] text-muted-fg">This tracker has no periods to publish.</li>
            ) : null}
          </ul>
        </div>

        {preview ? (
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview((v) => !v)}
              aria-expanded={showPreview}
              className="self-start"
            >
              {showPreview ? "Hide preview" : "Preview an issue"}
              <ChevronDown size={12} className={showPreview ? "rotate-180" : undefined} aria-hidden="true" />
            </Button>
            {showPreview ? (
              <div className="rounded-[var(--radius-lg)] bg-card-alt p-3">
                <div className="mb-2 text-[13px] font-bold text-fg">{preview.title}</div>
                <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap text-[12px] leading-[1.5] text-muted-fg">
                  {preview.body}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ink"
            onClick={confirm}
            disabled={saving || !repoValid || selected.length === 0}
            title={!repoValid ? "Pick a repository first" : selected.length === 0 ? "Pick at least one period" : undefined}
          >
            {saving
              ? "Publishing…"
              : `Create ${selected.length} ${selected.length === 1 ? "issue" : "issues"}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
