"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, MonoLabel, Pill, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { appendGoals, replaceGoals } from "./goals-store";
import {
  applyOrphanAssignments,
  mergeImport,
  parseImportFile,
} from "./import-parser";

/**
 * Import panel — drag-drop CSV/XLS files from Zoho People's "L1 View" and
 * "L2 View" exports, preview the parsed tree, then commit with replace /
 * append semantics.
 *
 * The parser auto-detects whether a file is L1 or L2 by column signature,
 * and each dropped file gets a level toggle so a mis-sniffed (or
 * unrecognized) file can be re-parsed as the other level. Orphaned L2s —
 * rows whose parent L1 isn't in the import — can be assigned to an L1
 * from a dropdown instead of being silently dropped.
 */
let _fileSeq = 0;

export function GoalsImport({ onClose }) {
  const inputRef = useRef(null);
  // [{ id, file, filename, detectedType, chosenType, rows, warning }]
  const [fileResults, setFileResults] = useState([]);
  const [orphanAssignments, setOrphanAssignments] = useState({}); // { l2Id: l1Id }
  const [mode, setMode] = useState("replace"); // "replace" | "append"
  const [working, setWorking] = useState(false);

  const handleFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setWorking(true);
    try {
      const results = await Promise.all(
        [...files].map(async (f) => {
          const r = await parseImportFile(f);
          return {
            id: `file-${++_fileSeq}`,
            file: f,
            filename: r.filename,
            detectedType: r.detectedType,
            chosenType: r.type,
            rows: r.rows,
            warning: r.warning,
          };
        }),
      );
      if (results.every((r) => r.rows.length === 0)) {
        toast.error("Nothing to import — check the file format.");
      }
      setFileResults((prev) => [...prev, ...results]);
    } finally {
      setWorking(false);
    }
  }, []);

  // Flip a file's level: re-parse the kept File with the forced type. A
  // forced parse that yields no rows means the file simply doesn't carry
  // the other level's columns — reject with a toast, keep current state.
  const flipFile = useCallback(
    async (id, newType) => {
      const entry = fileResults.find((f) => f.id === id);
      if (!entry || entry.chosenType === newType) return;
      setWorking(true);
      try {
        const r = await parseImportFile(entry.file, { forceType: newType });
        if (r.rows.length === 0) {
          toast.error(
            r.warning ||
              `${entry.filename}: no ${newType.toUpperCase()} rows found`,
          );
          return;
        }
        setFileResults((prev) =>
          prev.map((f) =>
            f.id === id
              ? { ...f, chosenType: newType, rows: r.rows, warning: undefined }
              : f,
          ),
        );
      } finally {
        setWorking(false);
      }
    },
    [fileResults],
  );

  const removeFile = useCallback((id) => {
    setFileResults((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearAll = () => {
    setFileResults([]);
    setOrphanAssignments({});
  };

  // Merge is derived, in two memo layers: `baseMerged` re-runs only when
  // the file set changes (mergeImport mints fallback ids, so re-running it
  // on every assignment change would invalidate the assignment keys), and
  // `parsed` re-homes assigned orphans on top. Stale assignment ids after
  // a file change are ignored by applyOrphanAssignments — no pruning pass.
  const baseMerged = useMemo(() => {
    const l1Rows = [];
    const l2Rows = [];
    for (const f of fileResults) {
      if (f.chosenType === "l1") l1Rows.push(...f.rows);
      if (f.chosenType === "l2") l2Rows.push(...f.rows);
    }
    if (l1Rows.length === 0 && l2Rows.length === 0) return null;
    return mergeImport({ l1Rows, l2Rows });
  }, [fileResults]);

  const parsed = useMemo(
    () => (baseMerged ? applyOrphanAssignments(baseMerged, orphanAssignments) : null),
    [baseMerged, orphanAssignments],
  );

  const warnings = fileResults.map((f) => f.warning).filter(Boolean);

  const onInputChange = (e) => {
    handleFiles(e.target.files);
    // Allow re-selecting the same file
    e.target.value = "";
  };

  const commit = () => {
    if (!parsed?.tree) return;
    if (mode === "replace") {
      if (
        !confirm(
          "Replace all existing goals with the imported tree? Your current goals are archived first — view them under Past cycles, not deleted.",
        )
      )
        return;
      replaceGoals(parsed.tree);
    } else {
      appendGoals(parsed.tree);
    }
    const skipped = parsed.stats.l2Unmatched;
    toast.success(
      `Imported ${parsed.stats.l1Count} L1 · ${parsed.stats.l2Matched} L2` +
        (skipped > 0 ? ` · ${skipped} orphan${skipped === 1 ? "" : "s"} skipped` : ""),
    );
    onClose?.();
  };

  return (
    <Card className="p-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <MonoLabel>Import from Zoho</MonoLabel>
          <p className="mt-1 max-w-xl text-[13px] leading-[1.55] text-muted-fg">
            Drop the L1 View <code className="font-mono text-fg">.csv</code>{" "}
            and the L2 View <code className="font-mono text-fg">.xls</code>{" "}
            you exported from Zoho People → Performance. We&apos;ll auto-detect
            which is which — and you can flip a file&apos;s level if the
            detection gets it wrong — then link each L2 to its parent L1 by
            title.
          </p>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="rounded-full p-1 text-dim-fg hover:bg-card-alt hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <DropZone
        disabled={working}
        onDropFiles={handleFiles}
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        multiple
        onChange={onInputChange}
        className="hidden"
      />

      {fileResults.length > 0 ? (
        <FileList
          files={fileResults}
          disabled={working}
          onFlip={flipFile}
          onRemove={removeFile}
        />
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-3 rounded-[var(--radius-sub)] border border-dashed border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[color-mix(in_srgb,var(--bad)_6%,transparent)] p-3 text-[12px] text-bad">
          {warnings.map((w, i) => (
            <li key={i} className="py-0.5">
              ⚠ {w}
            </li>
          ))}
        </ul>
      ) : null}

      {parsed ? (
        <>
          <Preview
            parsed={parsed}
            baseOrphans={baseMerged?.unmatchedL2s || []}
            assignments={orphanAssignments}
            onAssign={(l2Id, l1Id) =>
              setOrphanAssignments((prev) => {
                if (!l1Id) {
                  const { [l2Id]: _dropped, ...rest } = prev;
                  return rest;
                }
                return { ...prev, [l2Id]: l1Id };
              })
            }
            l1Options={baseMerged?.tree.l1s || []}
          />
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <ModeSwitch mode={mode} onChange={setMode} />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={clearAll}>
                Clear
              </Button>
              <Button onClick={commit}>
                <Upload className="h-4 w-4" />
                {mode === "replace" ? "Replace & import" : "Append"}{" "}
                {parsed.stats.l1Count} L1
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </Card>
  );
}

function DropZone({ onDropFiles, onClick, disabled }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        onDropFiles(e.dataTransfer.files);
      }}
      disabled={disabled}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-tile)] border-2 border-dashed px-6 py-10 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        over
          ? "border-accent bg-accent-dim"
          : "border-border bg-card-alt hover:border-border-strong",
      )}
    >
      <Download className="h-5 w-5 text-accent" />
      <div className="text-[13px] font-medium">
        {disabled ? "Parsing…" : "Drop files or click to browse"}
      </div>
      <div
        className="text-dim-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
      >
        Accepts .csv · .xls · .xlsx · multi-file
      </div>
    </button>
  );
}

/**
 * One row per dropped file: name, what the sniffer detected, an L1/L2
 * toggle to re-parse at the other level, and a remove button. The toggle
 * mirrors ModeSwitch's segmented-pill look.
 */
function FileList({ files, disabled, onFlip, onRemove }) {
  return (
    <ul className="mt-3 flex flex-col gap-1.5">
      {files.map((f) => (
        <li
          key={f.id}
          className="flex items-center gap-2 rounded-[var(--radius-sub)] border border-border bg-card-alt px-3 py-2"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[12.5px]" title={f.filename}>
            {f.filename}
          </span>
          <Pill tone={f.detectedType ? "muted" : "warn"} mono>
            {f.detectedType
              ? `detected ${f.detectedType.toUpperCase()}`
              : "unrecognized"}
          </Pill>
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5">
            {["l1", "l2"].map((level) => (
              <button
                key={level}
                type="button"
                disabled={disabled}
                onClick={() => onFlip(f.id, level)}
                title={`Treat this file's rows as ${level.toUpperCase()}`}
                className={cn(
                  "rounded-full px-2.5 py-0.5 uppercase tracking-[0.4px] disabled:cursor-not-allowed disabled:opacity-50",
                  f.chosenType === level
                    ? "bg-fg text-bg"
                    : "text-muted-fg hover:text-fg",
                )}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {level.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onRemove(f.id)}
            className="rounded-full p-1 text-dim-fg hover:bg-card hover:text-fg"
            aria-label={`Remove ${f.filename}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ModeSwitch({ mode, onChange }) {
  const options = [
    {
      value: "replace",
      label: "Replace existing",
      hint: "Wipe local goals and replace with the import.",
    },
    {
      value: "append",
      label: "Append",
      hint: "Keep existing; add new L1s (deduped by code).",
    },
  ];
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-card-alt p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          title={o.hint}
          className={cn(
            "rounded-full px-3 py-1 uppercase tracking-[0.4px]",
            mode === o.value
              ? "bg-fg text-bg"
              : "text-muted-fg hover:text-fg",
          )}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// `tree`/`stats` come from the post-assignment merge, but the orphan panel
// lists the PRE-assignment orphans — an assigned row stays visible with its
// Select showing the chosen L1, so the user can change or clear it.
function Preview({ parsed, baseOrphans, assignments, onAssign, l1Options }) {
  const { tree, stats } = parsed;
  return (
    <div className="mt-4 rounded-[var(--radius-sub)] border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <MonoLabel>Preview</MonoLabel>
        <div className="flex gap-2">
          <Pill tone="accent">{stats.l1Count} L1</Pill>
          <Pill tone="ok">{stats.l2Matched} L2 matched</Pill>
          {stats.l2Unmatched > 0 ? (
            <Pill tone="warn">{stats.l2Unmatched} orphaned</Pill>
          ) : null}
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {tree.l1s.map((l1) => (
          <li
            key={l1.id}
            className="rounded-[var(--radius-sub)] border border-border bg-card-alt px-3 py-2"
          >
            <div className="mb-1 flex items-start gap-2">
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  {l1.code ? (
                    <span
                      className="text-accent"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700 }}
                    >
                      {l1.code}
                    </span>
                  ) : null}
                  <span className="text-[12.5px] font-medium">
                    {l1.weightage > 0 ? `${l1.weightage}% · ` : ""}
                    {l1.title || "(no title)"}
                  </span>
                </div>
              </div>
            </div>
            <div
              className="ml-5 text-dim-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
            >
              └ {l1.l2s.length} L2{" "}
              {l1.l2s.length === 1 ? "child" : "children"} mapped
            </div>
          </li>
        ))}
      </ul>

      {baseOrphans.length > 0 ? (
        <div className="mt-3 rounded-[var(--radius-sub)] border border-dashed border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_6%,transparent)] p-3">
          <div
            className="mb-1 uppercase tracking-[0.5px] text-warn"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700 }}
          >
            {baseOrphans.length} L2{" "}
            {baseOrphans.length === 1 ? "row" : "rows"} couldn&apos;t find a
            parent L1
          </div>
          <p className="mb-2 text-[11.5px] leading-[1.4] text-muted-fg">
            Assign each row to an L1 below, or leave it out. Rows left out
            will NOT be imported.
          </p>
          <ul className="flex flex-col gap-1.5">
            {baseOrphans.map((l2) => (
              <li key={l2.id} className="flex items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate text-[12px]"
                  title={l2.parentTitle ? `Zoho parent: ${l2.parentTitle}` : undefined}
                >
                  {l2.code ? (
                    <span
                      className="mr-1.5 text-warn"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700 }}
                    >
                      {l2.code}
                    </span>
                  ) : null}
                  {l2.title || "(no title)"}
                </span>
                <Select
                  size="sm"
                  aria-label={`Parent L1 for ${l2.title || l2.code || "row"}`}
                  value={assignments[l2.id] || ""}
                  onChange={(e) => onAssign(l2.id, e.target.value)}
                >
                  <option value="">— leave out —</option>
                  {l1Options.map((l1) => (
                    <option key={l1.id} value={l1.id}>
                      {l1.code ? `${l1.code} ` : ""}
                      {l1.title || "(no title)"}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
