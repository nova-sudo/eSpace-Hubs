"use client";

/**
 * <GithubIssueChip link onSync /> — the one badge that says where a period
 * stands on GitHub: open with task progress, closed on a date, missing,
 * publishing, or waiting on a reconnect. The badge text links to the issue;
 * the small refresh glyph re-reads it (same look as the provenance chip);
 * a tiny "more" menu offers Republish / Unlink when the issue went missing
 * or the reading is stale. `actions={false}` drops that menu (read-only
 * surfaces such as the manager's correlation report — only the owner can
 * republish or unlink).
 *
 * JetBrains Mono only for the `#123` ref — everything else is Manrope.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { republishGithub, unlinkGithub } from "./api";
import { chipState, freshnessLabel, isActiveLink, isStale } from "./link-model";

export function GithubIssueChip({ link, onSync, className, actions = true }) {
  const [busy, setBusy] = useState(false);
  const state = chipState(link);
  const active = isActiveLink(link);
  const ref = link?.issueNumber ? `#${link.issueNumber}` : null;
  const linked = active && link.status === "linked" && link.issueUrl;
  const showMenu = actions && active && (link.state?.issueState === "missing" || isStale(link) || link.status === "failed");

  async function handleSync() {
    if (busy || !onSync) return;
    setBusy(true);
    try {
      await onSync();
    } catch (err) {
      toast.error(err?.message || "Couldn't refresh from GitHub.");
    } finally {
      setBusy(false);
    }
  }

  const tooltip = active ? `${state.title} ${capitalise(freshnessLabel(link))}.` : state.title;

  return (
    <span className={cn("inline-flex max-w-full items-center gap-1", className)}>
      <Badge tone={state.tone} className="max-w-full" title={tooltip}>
        {linked ? (
          <a
            href={link.issueUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate hover:underline"
            aria-label={`${state.label} ${ref || ""} — open on GitHub`.trim()}
          >
            {state.label}
          </a>
        ) : (
          <span className="truncate">{state.label}</span>
        )}
        {ref ? <span className="font-mono">{ref}</span> : null}
        {onSync && active ? (
          <button
            type="button"
            onClick={handleSync}
            disabled={busy}
            aria-label="Refresh from GitHub"
            title={busy ? "Refreshing…" : `${capitalise(freshnessLabel(link))}. Click to re-read the issue.`}
            className="inline-flex items-center rounded-full disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} className={busy ? "motion-safe:animate-spin" : undefined} />
          </button>
        ) : null}
      </Badge>
      {showMenu ? <ChipMenu link={link} /> : null}
    </span>
  );
}

function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Republish / Unlink — only offered when the issue is missing or stale. */
function ChipMenu({ link }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(action) {
    setOpen(false);
    if (working) return;
    setWorking(true);
    try {
      if (action === "republish") {
        await republishGithub(link.id);
        toast.success("Issue republished.");
      } else {
        await unlinkGithub(link.id);
        toast.success("Unlinked from GitHub. The issue stays where it is.");
      }
    } catch (err) {
      toast.error(err?.message || "That didn't go through.");
    } finally {
      setWorking(false);
    }
  }

  const items = [
    { key: "republish", label: "Republish" },
    { key: "unlink", label: "Unlink" },
  ];

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={working}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More GitHub actions"
        title="Republish or unlink"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-fg hover:bg-card-alt disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MoreHorizontal size={13} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 flex min-w-[150px] flex-col gap-0.5 rounded-[var(--radius-lg)] bg-card p-1.5"
          style={{ boxShadow: "var(--shadow-float)" }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => run(it.key)}
              className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-fg hover:bg-card-alt focus-visible:bg-card-alt focus-visible:outline-none"
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
