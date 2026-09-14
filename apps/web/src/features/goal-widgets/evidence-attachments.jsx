"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, Paperclip, Upload, X } from "lucide-react";
import { Badge, IconButton } from "@/components/ui";
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_MAX_BYTES,
  deleteEvidenceFile,
  evidenceFileUrl,
  formatBytes,
  listEvidenceFiles,
  uploadEvidenceFile,
} from "./evidence-files";

/**
 * Attach the deliverable itself to a period.
 *
 * A `link` field already covers an artifact that lives somewhere reachable.
 * This covers the ones that don't — "Phase 1 retrospective notes" is whatever
 * the person wrote it in, and asking them to first publish it somewhere with a
 * URL is how evidence stops getting attached at all. Any allowed format, up to
 * 10 MB, stored against this exact cadence window.
 *
 * Deliberately lazy: nothing is fetched until the section is opened. A goals
 * page renders many widgets at once, and most periods have no attachments —
 * a list request per widget per render would be pure noise.
 */
export function EvidenceAttachments({ goalId, periodKey, className = "" }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState(null); // null = not loaded yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const inputId = useId();
  // Guards against a resolved fetch writing into an unmounted (or re-keyed)
  // section — this component remounts every time the user steps to another
  // window in the stepper.
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!goalId) return;
    try {
      const rows = await listEvidenceFiles(goalId);
      if (!liveRef.current) return;
      // The server stores every attachment for the goal; this section only
      // owns the ones pinned to its own window.
      setFiles(rows.filter((f) => (f.periodKey ?? null) === (periodKey ?? null)));
    } catch (err) {
      if (liveRef.current) setError(err.message || "Couldn't load attachments.");
    }
  }, [goalId, periodKey]);

  useEffect(() => {
    if (open && files === null) void refresh();
  }, [open, files, refresh]);

  const doUpload = useCallback(
    async (fileList) => {
      const chosen = Array.from(fileList || []);
      if (chosen.length === 0) return;
      setError("");
      setBusy(true);
      try {
        // Sequential rather than parallel: the server's rate limiter is
        // per-session, and a dropped folder shouldn't spend the whole budget
        // in one burst.
        for (const file of chosen) {
          if (file.size > EVIDENCE_MAX_BYTES) {
            throw new Error(
              `${file.name} is over the ${Math.round(EVIDENCE_MAX_BYTES / (1024 * 1024))} MB limit.`,
            );
          }
          await uploadEvidenceFile({ goalId, periodKey, file });
        }
        await refresh();
      } catch (err) {
        if (liveRef.current) setError(err.message || "That upload didn't go through.");
      } finally {
        if (liveRef.current) setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [goalId, periodKey, refresh],
  );

  const remove = useCallback(
    async (fileId) => {
      setError("");
      setBusy(true);
      try {
        await deleteEvidenceFile(fileId);
        if (liveRef.current) setFiles((prev) => (prev || []).filter((f) => f.id !== fileId));
      } catch (err) {
        if (liveRef.current) setError(err.message || "Couldn't remove that file.");
      } finally {
        if (liveRef.current) setBusy(false);
      }
    },
    [],
  );

  if (!goalId) return null;
  const count = files?.length ?? 0;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-muted-fg hover:text-fg"
      >
        <ChevronRight size={13} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
        <Paperclip size={13} />
        Attach evidence
        {count > 0 ? <Badge>{count}</Badge> : null}
      </button>

      {open ? (
        <div className="flex flex-col gap-2">
          {/* Drop target. `label`-wrapped so a click and the keyboard both
              reach the file input without a hand-rolled key handler. */}
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void doUpload(e.dataTransfer?.files);
            }}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-lg)] px-3 py-3 text-center text-[12.5px] font-semibold transition-colors ${
              dragging ? "bg-lav text-lav-ink" : "bg-card-alt text-muted-fg hover:text-fg"
            }`}
          >
            <Upload size={14} />
            {busy ? "Uploading…" : "Drop a file here, or click to choose"}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept={EVIDENCE_ACCEPT}
            className="sr-only"
            onChange={(e) => void doUpload(e.target.files)}
          />

          {error ? <span className="text-[12.5px] text-peach-ink">{error}</span> : null}

          {count > 0 ? (
            <ul className="flex list-none flex-col gap-1 p-0">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-lg)] bg-card-alt px-2.5 py-1.5">
                  {/* A plain link: the API answers with Content-Disposition:
                      attachment, so even an .html attachment downloads rather
                      than rendering on our origin. */}
                  <a
                    href={evidenceFileUrl(f.id)}
                    download={f.name}
                    className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[12.5px] font-semibold text-fg hover:underline"
                    title={f.name}
                  >
                    <Paperclip size={12} className="shrink-0 text-muted-fg" />
                    <span className="truncate">{f.name}</span>
                  </a>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-[11.5px] text-dim-fg">{formatBytes(f.size)}</span>
                    <IconButton label={`Remove ${f.name}`} size="sm" onCard onClick={() => void remove(f.id)} disabled={busy}>
                      <X size={12} />
                    </IconButton>
                  </span>
                </li>
              ))}
            </ul>
          ) : files !== null ? (
            <span className="text-[12.5px] text-dim-fg">Nothing attached to this period yet</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
