"use client";

import { useCallback, useRef, useState } from "react";
import { Download, FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, MonoLabel, Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { appendGoals, replaceGoals } from "./goals-store";
import { mergeImport, parseImportFile } from "./import-parser";

/**
 * Import panel — drag-drop CSV/XLS files from Zoho People's "L1 View" and
 * "L2 View" exports, preview the parsed tree, then commit with replace /
 * append semantics.
 *
 * The parser auto-detects whether a file is L1 or L2 by column signature,
 * so users can drop multiple files in any order.
 */
export function GoalsImport({ onClose }) {
  const inputRef = useRef(null);
  const [parsed, setParsed] = useState(null); // { tree, unmatchedL2s, stats } | null
  const [warnings, setWarnings] = useState([]);
  const [mode, setMode] = useState("replace"); // "replace" | "append"
  const [working, setWorking] = useState(false);

  const handleFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setWorking(true);
    setWarnings([]);

    try {
      const results = await Promise.all(
        [...files].map((f) => parseImportFile(f)),
      );

      const l1Rows = [];
      const l2Rows = [];
      const newWarnings = [];

      for (const r of results) {
        if (r.warning) newWarnings.push(r.warning);
        if (r.type === "l1") l1Rows.push(...r.rows);
        if (r.type === "l2") l2Rows.push(...r.rows);
      }

      if (l1Rows.length === 0 && l2Rows.length === 0) {
        setParsed(null);
        setWarnings(newWarnings.length ? newWarnings : ["No L1 or L2 rows parsed."]);
        toast.error("Nothing to import — check the file format.");
        return;
      }

      const merged = mergeImport({ l1Rows, l2Rows });
      setParsed(merged);
      setWarnings(newWarnings);
    } finally {
      setWorking(false);
    }
  }, []);

  const onInputChange = (e) => {
    handleFiles(e.target.files);
    // Allow re-selecting the same file
    e.target.value = "";
  };

  const onDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const commit = () => {
    if (!parsed?.tree) return;
    if (mode === "replace") {
      if (!confirm("Replace all existing goals with the imported tree?")) return;
      replaceGoals(parsed.tree);
    } else {
      appendGoals(parsed.tree);
    }
    toast.success(
      `Imported ${parsed.stats.l1Count} L1 · ${parsed.stats.l2Matched} L2`,
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
            which is which and link each L2 to its parent L1 by title.
          </p>
        </div>
        {onClose ? (
          <button
            onClick={onClose}
            className="rounded-full p-1 text-dim-fg hover:bg-[rgba(0,0,0,0.04)] hover:text-fg"
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

      {warnings.length > 0 ? (
        <ul className="mt-3 rounded-[var(--radius-sub)] border border-dashed border-[rgba(185,28,28,0.3)] bg-[rgba(185,28,28,0.04)] p-3 text-[12px] text-bad">
          {warnings.map((w, i) => (
            <li key={i} className="py-0.5">
              ⚠ {w}
            </li>
          ))}
        </ul>
      ) : null}

      {parsed ? (
        <>
          <Preview parsed={parsed} />
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <ModeSwitch mode={mode} onChange={setMode} />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setParsed(null)}>
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

function Preview({ parsed }) {
  const { tree, unmatchedL2s, stats } = parsed;
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

      {unmatchedL2s.length > 0 ? (
        <div className="mt-3 rounded-[var(--radius-sub)] border border-dashed border-[rgba(234,88,12,0.3)] bg-[rgba(234,88,12,0.04)] p-3">
          <div
            className="mb-1 uppercase tracking-[0.5px] text-[#b45309]"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700 }}
          >
            {unmatchedL2s.length} L2{" "}
            {unmatchedL2s.length === 1 ? "row" : "rows"} couldn&apos;t find a
            parent L1
          </div>
          <p className="text-[11.5px] leading-[1.4] text-muted-fg">
            These usually mean the L2 file references L1s that weren&apos;t in
            the L1 export (or the titles don&apos;t match exactly). Re-export
            both files together from Zoho and try again.
          </p>
        </div>
      ) : null}
    </div>
  );
}
