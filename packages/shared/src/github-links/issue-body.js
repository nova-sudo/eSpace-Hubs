/**
 * What an eSpace-created issue says, and how to read one back.
 *
 * The body is the period's plan rendered for GitHub: focus, a `- [ ]` task
 * list of deliverables, the activities, the due date, and the marker as the
 * LAST line. Developers tick the task list where the work happens; eSpace
 * reads the ticks back with `taskListProgress`.
 *
 * Nothing here knows about GitHub's API, tokens or hosts. It builds strings
 * and parses strings.
 */

import { buildMarker } from "./marker.js";

const MAX_TITLE = 256;

function clean(s, max) {
  const t = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * `[<goalCode>] <periodLabel> — <goalTitle>`, bounded to GitHub's title cap.
 * The code goes first so a repo's issue list sorts by goal; the period label
 * is next so sibling issues read as a sequence.
 */
export function buildIssueTitle({ goalCode, goalTitle, periodLabel }) {
  const code = clean(goalCode, 40);
  const period = clean(periodLabel, 80);
  const title = clean(goalTitle, 160);
  const parts = [];
  if (code) parts.push(`[${code}]`);
  if (period) parts.push(period);
  const head = parts.join(" ");
  const full = title ? (head ? `${head} — ${title}` : title) : head || "eSpace goal";
  return full.length > MAX_TITLE ? `${full.slice(0, MAX_TITLE - 1)}…` : full;
}

function line(s) {
  // One line per bullet: a newline inside a deliverable would start a new
  // list item (or end the task list) on GitHub.
  return String(s).replace(/\r?\n+/g, " ").trim();
}

/**
 * @param {object} args
 * @param {object} args.period     the resolved period content (label, dueAt, detail)
 * @param {string} args.goalTitle
 * @param {string} [args.hubUrl]   deep link back to the tracker in eSpace
 * @param {object} args.marker     fields for buildMarker (orgId, userId, goalId, periodIndex, periodKey)
 */
export function buildIssueBody({ period, goalTitle, hubUrl, marker }) {
  const detail = period?.detail && typeof period.detail === "object" ? period.detail : {};
  const out = [];

  const title = clean(goalTitle, 200);
  if (title) out.push(`**Goal:** ${title}`);
  if (period?.label) out.push(`**Period:** ${clean(period.label, 120)}`);
  if (period?.dueAt) out.push(`**Due:** ${clean(period.dueAt, 40)}`);
  if (out.length) out.push("");

  if (detail.focus) {
    out.push("## Focus", "", line(detail.focus), "");
  }

  const deliverables = Array.isArray(detail.deliverables) ? detail.deliverables : [];
  out.push("## Deliverables", "");
  if (deliverables.length === 0) {
    out.push("- [ ] Period complete");
  } else {
    for (const d of deliverables) {
      const label = line(typeof d === "string" ? d : d?.label || "");
      if (!label) continue;
      const extras = [];
      if (d?.format) extras.push(line(d.format));
      if (d?.criteria) extras.push(`done when ${line(d.criteria)}`);
      out.push(`- [ ] ${label}${extras.length ? ` (${extras.join("; ")})` : ""}`);
    }
  }
  out.push("");

  const activities = Array.isArray(detail.activities) ? detail.activities : [];
  if (activities.length) {
    out.push("## Activities", "");
    for (const a of activities) {
      const t = line(a);
      if (t) out.push(`- ${t}`);
    }
    out.push("");
  }

  if (period?.prompt) {
    out.push("## Prompt", "", line(period.prompt), "");
  }

  if (typeof hubUrl === "string" && /^https:\/\//.test(hubUrl)) {
    out.push(`Tracked in eSpace: ${hubUrl}`, "");
  }

  out.push("---");
  out.push(
    "_Created by eSpace Dev Hub. Tick the boxes as you go; closing this issue logs the period as done._",
  );
  out.push("", buildMarker(marker));
  return out.join("\n");
}

// ─── reading back ────────────────────────────────────────────────────

const FENCE_RE = /^(```|~~~)/;
const TASK_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+\S/;

/**
 * Count GitHub task-list items in a markdown body. Items inside fenced code
 * are ignored, which is also what GitHub does. `{ done: 0, total: 0 }` for a
 * body with no list.
 */
export function taskListProgress(body) {
  if (typeof body !== "string" || !body) return { done: 0, total: 0 };
  let inFence = false;
  let done = 0;
  let total = 0;
  for (const raw of body.split(/\r?\n/)) {
    if (FENCE_RE.test(raw.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = TASK_RE.exec(raw);
    if (!m) continue;
    total += 1;
    if (m[1] !== " ") done += 1;
  }
  return { done, total };
}

const CLOSING_WORD = "(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)";
const REF_RE = new RegExp(
  `\\b${CLOSING_WORD}\\s*:?\\s+(?:(?:https?://github\\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/issues/(\\d+))|(?:([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#(\\d+))|#(\\d+))`,
  "gi",
);

/**
 * The issues a PR says it closes, in GitHub's own closing-keyword grammar.
 * Bare `#n` resolves to `repo` (the PR's own repository). Returns unique
 * `{ repo, number }` pairs, lower-cased repo.
 */
export function extractClosingRefs(text, { repo } = {}) {
  if (typeof text !== "string" || !text) return [];
  const own = typeof repo === "string" ? repo.toLowerCase() : null;
  const seen = new Set();
  const out = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(text)) !== null) {
    const r = (m[1] || m[3] || own || "").toLowerCase();
    const n = Number.parseInt(m[2] || m[4] || m[5], 10);
    if (!r || !Number.isInteger(n) || n <= 0) continue;
    const k = `${r}#${n}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ repo: r, number: n });
  }
  return out;
}
