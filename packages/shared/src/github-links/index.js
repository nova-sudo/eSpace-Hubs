/**
 * Public API for the GitHub-links domain — the correlation key between a
 * tracker period and a GitHub issue, the issue text, and the parsers that
 * read an issue back. Consumed by apps/api (publish + sync) and apps/web
 * (preview in the publish dialog).
 *
 * Subpath import:
 *   import { buildIssueBody, parseMarker } from "@espace-devhub/shared/github-links";
 */

export {
  buildCommentMarker,
  buildMarker,
  COMMENT_KINDS,
  ESPACE_LABEL,
  ESPACE_LABEL_COLOR,
  espaceLabel,
  MARKER_RE,
  MARKER_VERSION,
  parseCommentMarker,
  parseMarker,
} from "./marker.js";

export {
  buildIssueBody,
  buildIssueTitle,
  extractClosingRefs,
  taskListProgress,
} from "./issue-body.js";
