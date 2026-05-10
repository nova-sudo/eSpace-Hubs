"use client";

/**
 * Paste-ready review paragraph.
 *
 * Eats the same `metrics` array the rest of the evidence page uses, runs
 * it through the deterministic generator, and offers a one-click copy.
 * Zero AI by default — instant, offline, predictable.
 *
 * Optional "Polish with AI" button is the same paragraph passed through
 * `/api/chat` with a tonal-pass system prompt. We hide that button when
 * no AI is reachable (network errors fall through to a toast).
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, MonoLabel } from "@/components/ui";
import { generateReviewParagraph } from "./auto-paragraph";
import { useAiProvider } from "@/features/analyst/use-ai-provider";

export function ParagraphCard({ metrics, rangeLabel, level, starred }) {
  const baseParagraph = useMemo(
    () =>
      generateReviewParagraph({
        rangeLabel,
        metrics,
        starredCount: (starred || []).length,
        level,
      }),
    [metrics, rangeLabel, level, starred],
  );

  const [polished, setPolished] = useState(null);
  const [polishing, setPolishing] = useState(false);
  const { provider, aiHeaders } = useAiProvider();

  const text = polished ?? baseParagraph;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Paragraph copied — paste into your review form.");
    } catch {
      toast.error("Couldn't reach the clipboard. Select & copy manually.");
    }
  }

  async function handlePolish() {
    if (!baseParagraph) return;
    setPolishing(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiHeaders },
        body: JSON.stringify({
          provider,
          messages: [
            {
              role: "user",
              content: [
                "Below is a draft self-review paragraph from an engineer's",
                "performance dashboard. Make exactly two changes:",
                "1. Smooth any awkward transitions between sentences.",
                "2. Keep every number as-is — they are receipts, do not invent any.",
                "",
                "Return ONLY the rewritten paragraph. No prose around it.",
                "",
                baseParagraph,
              ].join("\n"),
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `${provider} ${res.status}`);
      }
      const data = await res.json();
      const out =
        typeof data?.content === "string" && data.content.trim().length > 0
          ? data.content.trim()
          : null;
      if (!out) throw new Error("AI returned an empty paragraph.");
      setPolished(out);
      toast.success(`Polished by ${provider}.`);
    } catch (err) {
      toast.error(`Polish failed: ${err?.message || err}`);
    } finally {
      setPolishing(false);
    }
  }

  function handleReset() {
    setPolished(null);
    toast("Reverted to deterministic draft.");
  }

  if (!baseParagraph) {
    return (
      <div className="rounded-[var(--radius-tile)] border border-dashed border-border bg-card-alt px-5 py-4 no-print">
        <MonoLabel>Auto paragraph</MonoLabel>
        <p className="mt-2 text-[13px] text-muted-fg">
          Connect GitHub or GitLab — the paragraph fills in once the metrics land.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-tile)] border border-border bg-card-alt px-5 py-4 no-print">
      <div className="flex items-baseline justify-between gap-3">
        <MonoLabel>Paste-ready paragraph</MonoLabel>
        <span
          className="text-muted-fg"
          style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}
        >
          {polished ? "polished by " + provider : "deterministic draft"} ·{" "}
          {text.length}c
        </span>
      </div>

      <p
        className="mt-2 text-[14px] leading-[1.6]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {text}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={handleCopy}>Copy paragraph</Button>
        <Button
          variant="ghost"
          onClick={handlePolish}
          disabled={polishing}
        >
          {polishing ? "Polishing…" : `Polish with ${provider}`}
        </Button>
        {polished ? (
          <Button variant="ghost" onClick={handleReset}>
            Revert to draft
          </Button>
        ) : null}
      </div>
    </div>
  );
}
