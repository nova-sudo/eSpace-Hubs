"use client";

/**
 * Evidence FILES for a goal period — the data layer.
 *
 * Distinct from `features/evidence`, which stars links to artifacts that
 * already live somewhere (a PR, a Jira ticket). This is for the deliverable
 * that has no URL: the retrospective notes someone wrote in a text file, an
 * exported PDF, a self-contained HTML report. The plan asked for an artifact;
 * this is where the artifact itself goes.
 *
 * Server: `/api/v1/goal-evidence` (GridFS-backed). Downloads always come back
 * as attachments — the API never serves an uploaded file inline, which is why
 * a link straight to the endpoint is safe to put in the UI.
 */

import { apiDelete, apiGet, apiPost } from "@/lib/api-client";

/** Mirrors the server's multer limit — reject locally before wasting an upload. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Mirrors the server's allow-list, and doubles as the `accept` attribute.
 * Kept in sync by hand; the server is the one that actually enforces it, and
 * rejects anything this list is wrong about.
 */
export const EVIDENCE_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.html,.htm,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,.zip";

/** Download URL for one stored file. Same-origin; the API forces attachment. */
export function evidenceFileUrl(fileId) {
  return `/api/v1/goal-evidence/file/${encodeURIComponent(fileId)}`;
}

/**
 * List a goal's attachments. `userId` is only for a manager reading a direct
 * report's evidence — the server checks the relationship, so passing it as
 * anyone else just returns a 404.
 */
export async function listEvidenceFiles(goalId, { userId } = {}) {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const res = await apiGet(`/goal-evidence/${encodeURIComponent(goalId)}${qs}`);
  if (!res.ok) throw new Error(res.error?.message || "Couldn't load attachments.");
  return res.data?.files ?? [];
}

/**
 * Attach one file to a goal, optionally pinned to one cadence window.
 *
 * `body: undefined` on the second argument is deliberate — it keeps api-client
 * from setting `Content-Type: application/json`; the FormData rides in via
 * `init` so the browser writes the multipart boundary itself.
 */
export async function uploadEvidenceFile({ goalId, periodKey, file, signal }) {
  if (!goalId) throw new Error("uploadEvidenceFile: goalId is required");
  if (!file) throw new Error("Choose a file first.");
  if (file.size > EVIDENCE_MAX_BYTES) {
    throw new Error(
      `That file is over the ${Math.round(EVIDENCE_MAX_BYTES / (1024 * 1024))} MB limit.`,
    );
  }
  const form = new FormData();
  form.append("file", file);
  if (periodKey) form.append("periodKey", periodKey);

  const res = await apiPost(`/goal-evidence/${encodeURIComponent(goalId)}`, undefined, {
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(res.error?.message || "That upload didn't go through.");
  return res.data?.file ?? null;
}

export async function deleteEvidenceFile(fileId) {
  const res = await apiDelete(`/goal-evidence/file/${encodeURIComponent(fileId)}`);
  if (!res.ok) throw new Error(res.error?.message || "Couldn't remove that file.");
}

/** Human-readable size. Bytes are never the useful unit for a document. */
export function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
