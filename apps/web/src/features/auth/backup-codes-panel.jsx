"use client";

/**
 * Two-factor backup codes, shown ONCE — right after enrolment and after
 * every regenerate. The server keeps only hashes, so this panel is the
 * user's single chance to copy or download them.
 *
 * Codes render in JetBrains Mono (the design system's face for codes)
 * in a two-column grid; "Copy all" puts them on the clipboard one per
 * line, "Download .txt" saves a small plain-text sheet.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * `onSaved` fires once the codes have left the screen — a successful copy
 * or a download. The dialogs use it to let the user close without the
 * "you haven't saved these" check.
 */
export function BackupCodesPanel({ codes, email, onSaved }) {
  const [copied, setCopied] = useState(false);
  const list = Array.isArray(codes) ? codes : [];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      setCopied(true);
      onSaved?.();
      toast.success("Backup codes copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the codes and copy them by hand.");
    }
  }

  function handleDownload() {
    const text = backupCodesText(list, email);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "espace-hubs-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    onSaved?.();
  }

  return (
    <div className="flex flex-col gap-3">
      <ol
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[var(--radius-lg)] bg-card-alt p-4"
      >
        {list.map((c) => (
          <li
            key={c}
            className="select-all text-center font-mono text-[14px] tracking-[0.06em] text-fg"
          >
            {c}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button type="button" variant="soft" size="sm" className="flex-1" onClick={handleCopy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy all"}
        </Button>
        <Button type="button" variant="soft" size="sm" className="flex-1" onClick={handleDownload}>
          <Download size={14} />
          Download .txt
        </Button>
      </div>
    </div>
  );
}

function backupCodesText(codes, email) {
  const lines = [
    "eSpace Hubs — two-factor backup codes",
    email ? `Account: ${email}` : null,
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Each code works once, in place of the 6-digit code from your",
    "authenticator app. Generating new codes cancels all of these.",
    "",
    ...codes,
    "",
  ].filter((l) => l !== null);
  return lines.join("\n");
}
