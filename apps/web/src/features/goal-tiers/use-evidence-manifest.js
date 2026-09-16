"use client";

/**
 * The files a person attached to a goal, in a form the grader can read.
 *
 * Uploaded evidence lived in GridFS and was rendered by exactly one
 * component. The grader could not see it, the markdown/PDF export left it
 * out, and the frozen review packet did not carry it. So the product asked
 * people to attach the artifact a plan explicitly called for, stored it
 * faithfully, and then graded them as though they had attached nothing.
 *
 * This is the read side of closing that gap. It returns a MANIFEST — names,
 * types, sizes, periods, upload dates — never file contents. The grader is
 * being told what exists and when it arrived, which is what a tier asking for
 * "a documented retrospective" actually needs to know. Shipping the bytes to
 * a model would be a different and much larger decision.
 *
 * Deep-imported from goal-widgets rather than through its barrel: the barrel
 * pulls the whole widget tree, and `goal-widgets/use-publish-reading` already
 * imports `@/features/goal-tiers`, so a barrel import here would close a
 * cycle between the two. Listed in `allowedDeepImports` with that reason.
 */

import useSWR from "swr";
import { listEvidenceFiles } from "@/features/goal-widgets/evidence-files";

/** Bytes are never the useful unit in prose. */
function shortSize(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function day(v) {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/**
 * Render a file list as grader-facing prose.
 *
 * Exported for the export/packet path and for tests, and pure so both can
 * use it without a React tree.
 */
export function evidenceManifestToText(files, cap = 12) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return "";

  const byPeriod = new Map();
  for (const f of list) {
    const pk = f?.periodKey || "unpinned";
    if (!byPeriod.has(pk)) byPeriod.set(pk, []);
    byPeriod.get(pk).push(f);
  }

  const lines = list
    .slice(0, cap)
    .map((f) => {
      // The API's list shape is `{ id, name, contentType, size, periodKey,
      // uploadedAt }` — not GridFS's own `filename`/`length`.
      const name = typeof f?.name === "string" ? f.name.trim() : "";
      if (!name) return null;
      const bits = [
        f?.periodKey ? `for ${f.periodKey}` : null,
        day(f?.uploadedAt) ? `uploaded ${day(f.uploadedAt)}` : null,
        shortSize(Number(f?.size)) || null,
      ].filter(Boolean);
      return `• ${name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return "";

  const periods = [...byPeriod.keys()].filter((k) => k !== "unpinned");
  const head =
    `${list.length} evidence file(s) attached to this goal` +
    (periods.length ? `, covering ${periods.sort().join(", ")}` : "") +
    (list.length > cap ? `; showing ${cap}` : "") +
    `. You are seeing the file MANIFEST, not the contents — treat a file as ` +
    `proof that the artifact exists and arrived when it did, not as a claim ` +
    `about what it says:`;

  return [head, ...lines].join("\n");
}

/**
 * A goal's attachment manifest. `null` while it has never resolved, so the
 * caller can tell "no files" from "not asked yet" and avoid grading a goal
 * as unevidenced simply because a fetch is still in flight.
 */
export function useEvidenceManifest(goalId) {
  const { data, error, isLoading } = useSWR(
    goalId ? ["goal-evidence-manifest", goalId] : null,
    () => listEvidenceFiles(goalId),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      dedupingInterval: 60_000,
    },
  );
  return {
    files: Array.isArray(data) ? data : null,
    loading: Boolean(isLoading),
    error: error || null,
  };
}
