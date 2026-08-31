"use client";

/**
 * "Starred proof" sidebar card — the resurrected UI over the
 * long-orphaned evidence store (Mongo collection + 4 audited endpoints
 * + this feature's own store/hooks, all shipped and consumer-less since
 * `evidence-picker.jsx` was removed). Lets the user pin concrete
 * artifacts — recent merged PRs, closed Jira tickets — as proof, and
 * the compiled review document renders them in a "Starred proof"
 * section (markdown, preview, and PDF).
 */

import { useState } from "react";
import { MonoLabel } from "@/components/ui";
import {
  toggleEvidence,
  useEvidenceCandidates,
  useStarredEvidence,
} from "./use-evidence";

export function StarredEvidenceCard() {
  const starred = useStarredEvidence();
  const candidates = useEvidenceCandidates();
  const [picking, setPicking] = useState(false);

  return (
    <div className="rounded-[11px] border border-border bg-card p-[17px]">
      <div
        className="mb-3 flex items-baseline justify-between uppercase tracking-[2px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        <span>Starred proof</span>
        <span className="tracking-[0.5px] text-dim-fg">{starred.length}</span>
      </div>

      {starred.length === 0 && !picking ? (
        <p className="text-[12px] leading-[1.5] text-muted-fg">
          Pin the PRs and tickets that prove your goals — they render as a
          &ldquo;Starred proof&rdquo; section in the compiled review.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {starred.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <span className="min-w-0 flex-1 text-[12px] leading-[1.45]">
                {s.ref ? (
                  <span
                    className="mr-1.5 text-accent"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700 }}
                  >
                    {s.ref}
                  </span>
                ) : null}
                <span className="text-fg">{s.title || "(untitled)"}</span>
                {s.date ? (
                  <span className="ml-1.5 text-dim-fg" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                    {s.date}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => toggleEvidence(s)}
                aria-label={`Remove ${s.ref || s.title} from starred proof`}
                className="shrink-0 text-dim-fg hover:text-bad"
                style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {picking ? (
        <div className="mt-3 border-t border-dashed border-border pt-3">
          <MonoLabel className="mb-2 block">Recent work</MonoLabel>
          {candidates.length === 0 ? (
            <p className="text-[11.5px] text-muted-fg">
              Nothing new to add — recent merged PRs and closed tickets show
              up here.
            </p>
          ) : (
            <ul className="flex max-h-52 flex-col gap-1.5 overflow-y-auto pr-1">
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => toggleEvidence(c)}
                    className="flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1 text-left hover:bg-card-alt"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-accent"
                      style={{ fontSize: 11 }}
                    >
                      ☆
                    </span>
                    <span className="min-w-0 flex-1 text-[12px] leading-[1.4]">
                      {c.ref ? (
                        <span
                          className="mr-1.5 text-muted-fg"
                          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
                        >
                          {c.ref}
                        </span>
                      ) : null}
                      <span className="text-fg">{c.title || "(untitled)"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setPicking((v) => !v)}
        className="mt-3 uppercase tracking-[0.6px] text-accent hover:underline"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 700 }}
      >
        {picking ? "Done" : "+ Add proof"}
      </button>
    </div>
  );
}
