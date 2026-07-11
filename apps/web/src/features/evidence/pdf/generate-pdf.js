"use client";

/**
 * Client-side PDF generation for the evidence export.
 *
 * @react-pdf/renderer and the document tree are DYNAMICALLY imported so the
 * (heavy) PDF stack stays out of the SSR bundle and the initial page load —
 * it's only fetched when the user actually exports. Produces a Blob in the
 * browser (no server round-trip, honoring the "data never leaves the browser"
 * contract) and downloads it via the same anchor pattern as the markdown path.
 */

import { createElement } from "react";

export async function generateEvidencePdf(props, filename = "performance-review.pdf") {
  if (typeof window === "undefined") return;
  const [{ pdf }, { EvidencePdfDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./evidence-pdf-document.jsx"),
  ]);
  const blob = await pdf(createElement(EvidencePdfDocument, props)).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
