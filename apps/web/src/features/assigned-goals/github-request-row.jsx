"use client";

/**
 * "GitHub issues" — the creator asks every assignee to publish this goal's
 * periods as GitHub issues. Each assignee publishes with their OWN GitHub
 * account (only repo collaborators can be issue assignees, and the manager
 * hub has no integrations), so the repo here is only a suggestion their
 * publish dialog prefills. Left blank, each assignee picks their own.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Label } from "@/components/ui";
import { isGithubRepoSlug } from "@/features/github-links";
import { requestGithubPublish } from "./api";
import { fmtDay } from "./progress-grid";

/** How many assignees have at least one linked issue on this goal. */
function publishedCount(rows) {
  return (rows || []).filter((r) => (r.cells || []).some((c) => c.github)).length;
}

export function GithubRequestRow({ goal, rows }) {
  const request = goal?.github ?? null;
  const [editing, setEditing] = useState(false);
  const [repo, setRepo] = useState(request?.repo ?? "");
  const [saving, setSaving] = useState(false);

  const trimmed = repo.trim();
  const valid = trimmed === "" || isGithubRepoSlug(trimmed);
  const showForm = !request || editing;
  const published = publishedCount(rows);
  const total = rows?.length ?? 0;

  async function send() {
    if (saving || !valid) return;
    setSaving(true);
    try {
      await requestGithubPublish(goal.id, { repo: trimmed || null });
      toast.success(
        request
          ? "Request updated. Assignees were notified again."
          : "Asked the assignees to publish to GitHub.",
      );
      setEditing(false);
    } catch (err) {
      toast.error(err?.message || "Couldn't send the request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label as="label" htmlFor="gh-request-repo">
        GitHub issues
      </Label>
      {request && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[13px] text-fg">
            Requested {fmtDay(Date.parse(request.requestedAt))} ·{" "}
            {request.repo ? (
              <span className="font-mono">{request.repo}</span>
            ) : (
              "repository of their choice"
            )}
            <span className="text-muted-fg">
              {" "}
              · {published} of {total} published
            </span>
          </div>
          <Button
            type="button"
            variant="soft"
            size="sm"
            onClick={() => {
              setRepo(request.repo ?? "");
              setEditing(true);
            }}
          >
            Update
          </Button>
        </div>
      ) : null}
      {showForm ? (
        <>
          <div className="text-[13px] text-muted-fg">
            Each assignee publishes one issue per period with their own GitHub account.
            Closing an issue logs that period here. Leave the repository blank to let them choose.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="gh-request-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name (optional)"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!valid}
              className="h-9 min-w-0 flex-1 basis-[220px] font-mono text-[13px]"
            />
            {editing ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
            ) : null}
            <Button type="button" variant="ink" size="sm" onClick={() => void send()} disabled={saving || !valid}>
              {saving ? "Sending…" : request ? "Send again" : "Ask assignees to publish"}
            </Button>
          </div>
          {!valid ? (
            <div className="text-[12px] text-peach-text">Use the owner/name form, like acme/app.</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
