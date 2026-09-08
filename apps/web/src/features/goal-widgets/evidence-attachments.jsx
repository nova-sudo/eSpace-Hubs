"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
export function EvidenceAttachments({ goalId, periodKey, variant = "dark", className = "" }) {
  const isLight = variant === "light";
  const tone = {
    fg: isLight ? "#ffffff" : "var(--fg)",
    muted: isLight ? "rgba(255,255,255,0.68)" : "var(--muted-fg)",
    faint: isLight ? "rgba(255,255,255,0.45)" : "var(--border-strong)",
    rule: isLight ? "rgba(255,255,255,0.22)" : "var(--border)",
    surface: isLight ? "rgba(255,255,255,0.10)" : "var(--card-alt)",
  };
  const mono = { fontFamily: "var(--font-mono)", fontSize: 10 };

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
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5"
        style={{
          ...mono,
          fontSize: 9,
          letterSpacing: "0.6px",
          textTransform: "uppercase",
          color: tone.muted,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}>
          &rsaquo;
        </span>
        attach evidence
        {count > 0 ? <span style={{ color: tone.fg }}>· {count}</span> : null}
      </button>

      {open ? (
        <div className="flex flex-col gap-1.5">
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
            className="flex cursor-pointer items-center justify-center rounded-[var(--radius-sub)] px-2 py-2.5 text-center"
            style={{
              ...mono,
              fontSize: 9.5,
              color: dragging ? tone.fg : tone.muted,
              border: `1px dashed ${dragging ? tone.fg : tone.rule}`,
              background: dragging ? tone.surface : "transparent",
            }}
          >
            {busy ? "uploading…" : "drop a file here, or click to choose"}
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

          {error ? (
            <span style={{ ...mono, fontSize: 9.5, color: isLight ? "#ffd7d7" : "var(--bad)" }}>
              {error}
            </span>
          ) : null}

          {count > 0 ? (
            <ul className="flex list-none flex-col gap-1 p-0">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-sub)] px-2 py-1"
                  style={{ background: tone.surface }}
                >
                  {/* A plain link: the API answers with Content-Disposition:
                      attachment, so even an .html attachment downloads rather
                      than rendering on our origin. */}
                  <a
                    href={evidenceFileUrl(f.id)}
                    download={f.name}
                    className="truncate underline-offset-2 hover:underline"
                    style={{ ...mono, fontSize: 10, color: tone.fg }}
                    title={f.name}
                  >
                    {f.name}
                  </a>
                  <span className="flex shrink-0 items-center gap-2">
                    <span style={{ ...mono, fontSize: 9, color: tone.faint }}>
                      {formatBytes(f.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(f.id)}
                      disabled={busy}
                      aria-label={`Remove ${f.name}`}
                      style={{
                        ...mono,
                        fontSize: 9,
                        color: tone.muted,
                        border: "none",
                        background: "transparent",
                        cursor: busy ? "default" : "pointer",
                      }}
                    >
                      remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : files !== null ? (
            <span style={{ ...mono, fontSize: 9.5, color: tone.faint }}>
              nothing attached to this period yet
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
