#!/usr/bin/env node
/**
 * sim-qa.mjs — one-shot data generator for the QA Hub demo.
 *
 * Creates:
 *   - N Jira tickets in the configured ESPQA project
 *   - M GitHub PRs on nova-sudo/qa-sim-target, each linked to a
 *     ticket via "Resolves ESPQA-NNN" in the body
 *   - K Jenkins builds with mixed env vars (some forced red,
 *     some forced deterministic, one slow) so the dashboard tiles
 *     show variance
 *
 * Idempotent in the loose sense: re-running it just adds more
 * artefacts on top of whatever's already there. To start clean,
 * delete the ESPQA project + qa-sim-target branches manually.
 *
 * Usage:
 *   node scripts/sim-qa.mjs                            # defaults
 *   node scripts/sim-qa.mjs --tickets=5 --prs=3 --builds=10
 *   node scripts/sim-qa.mjs --dry-run                  # log only
 *   node scripts/sim-qa.mjs --skip-prs --skip-builds   # tickets only
 *
 * Env reads from apps/api/.env.local (loaded via best-effort parse —
 * no dotenv dep, the file is tiny). Required:
 *
 *   SIM_JIRA_URL            https://your-tenant.atlassian.net
 *   SIM_JIRA_EMAIL          atlassian-account-email@whatever
 *   SIM_JIRA_API_TOKEN      from id.atlassian.com → API tokens
 *   SIM_JIRA_PROJECT_KEY    ESPQA
 *
 *   SIM_JENKINS_BASE_URL    https://<ngrok>.ngrok-free.dev OR
 *                            http://localhost:8080 if the script is
 *                            running on the same host as Jenkins
 *   SIM_JENKINS_USER        Jenkins username
 *   SIM_JENKINS_API_TOKEN   from /me/configure
 *   SIM_JENKINS_JOB         qa-sim-target (default)
 *   SIM_JENKINS_REMOTE_TOKEN gh-actions-trigger-2026 (the value of
 *                            the job's "Trigger builds remotely"
 *                            authentication token; required when set
 *                            on the job side, optional otherwise)
 *
 *   SIM_GH_REPO             nova-sudo/qa-sim-target (default)
 *
 * Designed to run from the repo root: `cd /path/to/espace-devhub`
 * before invoking.
 *
 * No third-party deps — uses node:fs, node:child_process, and the
 * built-in fetch (Node 18+ required).
 */

import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, "apps/api/.env.local");

// ─── tiny .env loader ──────────────────────────────────────────────

/**
 * Parse `KEY=value` lines from a .env file. No dotenv dep — the format
 * is simple enough and pulling a package for this script alone is
 * overkill. Values can be wrapped in single or double quotes; we strip
 * one matching pair. Lines starting with `#` are comments.
 */
function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    log.warn(`env file not found at ${filePath} — using process.env only`);
    return;
  }
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Don't clobber env vars set explicitly at runtime.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ─── logging ──────────────────────────────────────────────────────

const log = {
  info: (...args) => console.log("·", ...args),
  ok: (...args) => console.log("✓", ...args),
  warn: (...args) => console.warn("!", ...args),
  err: (...args) => console.error("✗", ...args),
  head: (msg) =>
    console.log(`\n${"─".repeat(60)}\n  ${msg}\n${"─".repeat(60)}`),
};

// ─── argv parsing ─────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    tickets: 5,
    prs: 3,
    builds: 10,
    skipTickets: false,
    skipPrs: false,
    skipBuilds: false,
    dryRun: false,
  };
  for (const raw of argv) {
    if (raw === "--dry-run") out.dryRun = true;
    else if (raw === "--skip-tickets") out.skipTickets = true;
    else if (raw === "--skip-prs") out.skipPrs = true;
    else if (raw === "--skip-builds") out.skipBuilds = true;
    else if (raw.startsWith("--tickets=")) out.tickets = +raw.slice(10);
    else if (raw.startsWith("--prs=")) out.prs = +raw.slice(6);
    else if (raw.startsWith("--builds=")) out.builds = +raw.slice(9);
    else if (raw === "-h" || raw === "--help") {
      printHelp();
      process.exit(0);
    } else {
      log.err(`unknown argument: ${raw}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/sim-qa.mjs [flags]

Flags:
  --tickets=N         number of Jira tickets to create (default 5)
  --prs=N             number of GitHub PRs to open (default 3)
  --builds=N          number of Jenkins builds to trigger (default 10)
  --skip-tickets      don't touch Jira
  --skip-prs          don't touch GitHub
  --skip-builds       don't touch Jenkins
  --dry-run           log what would happen, don't actually call APIs
  -h, --help          this help

Env vars are loaded from apps/api/.env.local. See script header for
the SIM_* keys required.
`);
}

// ─── ticket / PR data pools ────────────────────────────────────────

// Deliberately varied so the QA Hub's "defect mix" + per-tile widgets
// have interesting input. We pick from these at random.
const TICKET_TEMPLATES = [
  { type: "Bug", summary: "Cart total rounding off by one cent on multi-item discounts", priority: "Medium" },
  { type: "Bug", summary: "Flaky checkout test fails ~20% of CI runs", priority: "High" },
  { type: "Bug", summary: "VAT-exclusive helper returns NaN when vatPercent is 0", priority: "Low" },
  { type: "Bug", summary: "Shipping threshold not applied on currency conversion", priority: "Medium" },
  { type: "Task", summary: "Add idempotency key to /checkout POST", priority: "Medium" },
  { type: "Task", summary: "Document the env vars in qa-sim-target's README", priority: "Low" },
  { type: "Bug", summary: "Empty cart accepts negative-quantity items", priority: "High" },
  { type: "Bug", summary: "Discount stacking allows >100% off via two coupons", priority: "Highest" },
  { type: "Task", summary: "Extract pricing module unit tests into separate suite", priority: "Low" },
  { type: "Bug", summary: "Session timeout simulator races on slow Jenkins agents", priority: "Medium" },
];

const PR_TEMPLATES = [
  { title: "Fix cart total rounding on discounted multi-item carts", branch: "fix/cart-rounding" },
  { title: "Stabilise the flaky checkout test (reduce variance)", branch: "fix/flake-checkout" },
  { title: "Guard vatExclusive against vatPercent === 0", branch: "fix/vat-zero-divisor" },
  { title: "Add idempotency-key support to POST /checkout", branch: "feat/idempotency-checkout" },
  { title: "Reject negative-qty items in addItem", branch: "fix/negative-qty" },
  { title: "Cap discount stacking at 100%", branch: "fix/discount-stacking" },
];

// Mix of env-var combos for Jenkins builds. Each entry is what we
// pass as build parameters. The pipeline accepts them as plain env.
const BUILD_VARIANTS = [
  {}, // pure default
  { FLAKY_FAIL_RATE: "0" }, // deterministic
  {}, // default again — bias toward "normal" runs
  { SIMULATE_BROKEN: "1" }, // forced red
  { FLAKY_FAIL_RATE: "0.5" }, // very flaky
  {}, // default
  { FAST_SUITE: "1" }, // skip slow test
  { SIMULATE_BROKEN: "1" }, // forced red
  {}, // default
  { FLAKY_FAIL_RATE: "0" }, // deterministic again
];

// ─── helpers ──────────────────────────────────────────────────────

function pick(arr, i) {
  return arr[i % arr.length];
}

function basicAuthHeader(user, password) {
  return "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
}

async function fetchJson(url, init = {}) {
  const r = await fetch(url, init);
  const text = await r.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    // Jira's response shape is annoying:
    //   `errorMessages` is an array of strings (top-level errors)
    //   `errors` is an OBJECT keyed by field name → message (field-level)
    // Older endpoints sometimes return `errors` as an array. Handle both
    // so the user sees the actual reason instead of a TypeError from
    // calling .join on an object.
    let detail = "";
    if (Array.isArray(parsed?.errorMessages) && parsed.errorMessages.length) {
      detail = parsed.errorMessages.join("; ");
    }
    if (!detail && parsed?.errors) {
      if (Array.isArray(parsed.errors)) {
        detail = parsed.errors.join("; ");
      } else if (typeof parsed.errors === "object") {
        const pairs = Object.entries(parsed.errors).map(
          ([field, msg]) => `${field}: ${msg}`,
        );
        if (pairs.length) detail = pairs.join("; ");
      }
    }
    if (!detail) detail = parsed?.message || text.slice(0, 300);
    const err = new Error(`HTTP ${r.status} on ${url} — ${detail}`);
    err.status = r.status;
    err.body = parsed ?? text;
    throw err;
  }
  return parsed;
}

// ─── Jira ─────────────────────────────────────────────────────────

// Cache of issuetypes the current Jira project actually has. Filled
// during preflight by hitting /createmeta. `resolveIssueType` maps a
// template's desired type (e.g. "Bug") onto whatever the project
// supports — falling back to Task or the first available type if
// the requested one isn't present.
let _availableIssueTypes = null;

async function fetchProjectIssueTypes(env) {
  // The /createmeta/{key}/issuetypes endpoint is the modern (post-2024)
  // replacement for the deprecated /createmeta?expand=...&projectKeys=...
  // It returns { issueTypes: [{ name, ... }, ...], maxResults, ... }
  // or { values: [...] } on some Jira versions.
  const url = `${env.SIM_JIRA_URL.replace(/\/$/, "")}/rest/api/3/issue/createmeta/${env.SIM_JIRA_PROJECT_KEY}/issuetypes`;
  const data = await fetchJson(url, {
    headers: {
      Authorization: basicAuthHeader(env.SIM_JIRA_EMAIL, env.SIM_JIRA_API_TOKEN),
      Accept: "application/json",
    },
  });
  const list = Array.isArray(data?.issueTypes)
    ? data.issueTypes
    : Array.isArray(data?.values)
      ? data.values
      : [];
  return list.map((t) => t.name).filter(Boolean);
}

/** Map a template's requested issuetype onto something the project has. */
function resolveIssueType(requested) {
  if (!_availableIssueTypes || _availableIssueTypes.length === 0) {
    // Unknown — pass through and let Jira reject if it's wrong.
    return requested;
  }
  const ciMatch = _availableIssueTypes.find(
    (n) => n.toLowerCase() === requested.toLowerCase(),
  );
  if (ciMatch) return ciMatch;
  // Common downgrade target — most Jira projects have at least Task.
  const task = _availableIssueTypes.find((n) => n.toLowerCase() === "task");
  if (task) return task;
  // Last resort: pick the first non-Epic, non-Subtask type so we don't
  // try to create an Epic without the required `customfield_10011`.
  const fallback =
    _availableIssueTypes.find(
      (n) => !/^(epic|sub.?task)$/i.test(n),
    ) || _availableIssueTypes[0];
  return fallback;
}

async function preflightJira(env) {
  const url = `${env.SIM_JIRA_URL.replace(/\/$/, "")}/rest/api/3/project/${env.SIM_JIRA_PROJECT_KEY}`;
  try {
    const project = await fetchJson(url, {
      headers: {
        Authorization: basicAuthHeader(env.SIM_JIRA_EMAIL, env.SIM_JIRA_API_TOKEN),
        Accept: "application/json",
      },
    });
    log.ok(`jira project found: ${project.key} (${project.name})`);

    // Discover issuetypes so we can adapt to projects without "Bug"
    // (common on Jira Work Management — those ship Task/Epic only).
    try {
      _availableIssueTypes = await fetchProjectIssueTypes(env);
      if (_availableIssueTypes.length > 0) {
        log.ok(`jira issuetypes: ${_availableIssueTypes.join(", ")}`);
        const hasBug = _availableIssueTypes.some(
          (n) => n.toLowerCase() === "bug",
        );
        if (!hasBug) {
          log.warn(
            `project ${env.SIM_JIRA_PROJECT_KEY} has no "Bug" issuetype — ` +
              `Bug-templated tickets will downgrade to "${resolveIssueType("Bug")}". ` +
              `The QA Hub defect widgets query \`issuetype = Bug\` and will read 0 ` +
              `until Bug is added under Jira → Project settings → Issue types.`,
          );
        }
      }
    } catch (metaErr) {
      log.warn(
        `couldn't fetch project issuetypes (${metaErr.message}); ` +
          `will pass template types through as-is`,
      );
    }

    return project;
  } catch (e) {
    if (e.status === 404) {
      log.err(
        `jira project ${env.SIM_JIRA_PROJECT_KEY} not found. Create it at ` +
          `${env.SIM_JIRA_URL}/jira/projects → Create project → key=${env.SIM_JIRA_PROJECT_KEY}, then re-run.`,
      );
    } else if (e.status === 401) {
      log.err(
        `jira auth failed (401). Check SIM_JIRA_EMAIL + SIM_JIRA_API_TOKEN in apps/api/.env.local. ` +
          `Generate a fresh token at id.atlassian.com → API tokens.`,
      );
    } else {
      log.err(`jira preflight failed: ${e.message}`);
    }
    throw e;
  }
}

async function createTicket(env, template) {
  const url = `${env.SIM_JIRA_URL.replace(/\/$/, "")}/rest/api/3/issue`;
  // Jira v3 wants `description` as Atlassian Document Format. We use
  // the minimum legal doc shape — one paragraph with one text node.
  const description = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              "Synthetic ticket created by sim-qa.mjs for QA Hub data simulation. " +
              "Safe to close / delete in bulk.",
          },
        ],
      },
    ],
  };
  const issueTypeName = resolveIssueType(template.type);
  const baseFields = {
    project: { key: env.SIM_JIRA_PROJECT_KEY },
    summary: template.summary,
    issuetype: { name: issueTypeName },
    description,
  };

  // Some Jira projects don't have `priority` or `labels` on the Create
  // screen for every issuetype (especially Bug). Hitting that returns
  // a 400 with `errors: { priority: "Field cannot be set..." }`.
  //
  // Strategy: try with the full payload first; on 400 retry without
  // priority + labels. We surface a `partial` flag so the caller can
  // log that priority-mix data won't be populated for that ticket.
  const fullFields = {
    ...baseFields,
    priority: { name: template.priority },
    labels: ["qa-hub-sim", "synthetic"],
  };

  const post = (fields) =>
    fetchJson(url, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(env.SIM_JIRA_EMAIL, env.SIM_JIRA_API_TOKEN),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields }),
    });

  try {
    const issue = await post(fullFields);
    return { key: issue.key, summary: template.summary, partial: false };
  } catch (e) {
    if (e.status !== 400) throw e;
    // Re-throw with the original error details if the minimal retry
    // also fails — so the user sees the real Jira message either way.
    try {
      const issue = await post(baseFields);
      return {
        key: issue.key,
        summary: template.summary,
        partial: true,
        droppedReason: e.message,
      };
    } catch (e2) {
      throw e2;
    }
  }
}

// ─── GitHub PRs (via gh CLI) ──────────────────────────────────────

function sh(cmd, opts = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(
      `command failed (${r.status}): ${cmd}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  }
  return r.stdout;
}

function preflightGitHub(env) {
  try {
    const out = sh("gh auth status --hostname github.com 2>&1");
    if (!/Logged in to github\.com/i.test(out)) {
      throw new Error("gh CLI not authenticated");
    }
    log.ok(`gh CLI authenticated`);
  } catch (e) {
    log.err(
      `gh CLI not ready: ${e.message}. Run 'gh auth login' to fix, then re-run.`,
    );
    throw e;
  }
}

/**
 * Clone qa-sim-target into a temp dir, make a one-line change on a
 * fresh branch, push, open a PR linked to the given ticket. Returns
 * the PR URL. Temp dir is cleaned up at the end.
 */
function createPr(env, template, ticketKey, repoTmpRoot) {
  const branch = `${template.branch}-${Date.now().toString(36).slice(-5)}`;
  const cloneDir = path.join(repoTmpRoot, branch);

  log.info(`  cloning into ${cloneDir}`);
  sh(`git clone --depth=1 https://github.com/${env.SIM_GH_REPO}.git "${cloneDir}"`);

  // Make a real diff so the PR has something to merge. We write a
  // unique file per PR under `sim-qa-notes/` rather than appending
  // to README — appending via `echo "..." >> README.md` is shell-
  // quoting hell on Windows (the literal "\n" inside the quoted
  // string crashes cmd.exe parsing and the file ends up untouched,
  // which gives the misleading "nothing to commit" error).
  //
  // Writing through Node's fs sidesteps the shell entirely and
  // gives us a guaranteed diff with predictable contents.
  // Note path is `sim-qa-notes/<branch>.md`. The branch is something
  // like `fix/cart-rounding-xrrp5` — the `/` means writeFileSync needs
  // the `sim-qa-notes/fix/` subdir to already exist, so mkdir
  // recursively on the file's dirname rather than just on the root.
  const notePath = path.join(cloneDir, "sim-qa-notes", `${branch}.md`);
  mkdirSync(path.dirname(notePath), { recursive: true });
  writeFileSync(
    notePath,
    `# sim-qa marker\n\n` +
      `- ticket: ${ticketKey}\n` +
      `- created: ${new Date().toISOString()}\n` +
      `- title:   ${template.title}\n\n` +
      `Synthetic file created by sim-qa.mjs. Safe to delete.\n`,
    "utf8",
  );

  sh(`git checkout -b ${branch}`, { cwd: cloneDir });
  sh(`git add sim-qa-notes`, { cwd: cloneDir });
  sh(
    `git -c user.email=sim-qa@local -c user.name="sim-qa" commit -m "${template.title} (${ticketKey})"`,
    { cwd: cloneDir },
  );
  sh(`git push -u origin ${branch}`, { cwd: cloneDir });

  // gh pr create supports --body-file but our body is short — inline
  // is fine. The "Resolves <KEY>" line is what the QA Hub's linkage
  // widget will mine later.
  const body =
    `Resolves ${ticketKey}\n\n` +
    `Synthetic PR opened by sim-qa.mjs for QA Hub data simulation. ` +
    `Body is short on purpose. Safe to close + delete branch in bulk.`;
  const prUrl = sh(
    `gh pr create --repo "${env.SIM_GH_REPO}" --title "${template.title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}" --head "${branch}" --base main`,
    { cwd: cloneDir },
  ).trim();

  return { url: prUrl, branch, title: template.title };
}

// ─── Jenkins ──────────────────────────────────────────────────────

async function preflightJenkins(env) {
  // /api/json is the cheapest authenticated endpoint that confirms
  // creds work. We pass tree=mode to keep the response tiny.
  const url = `${env.SIM_JENKINS_BASE_URL.replace(/\/$/, "")}/api/json?tree=mode,nodeDescription`;
  try {
    const meta = await fetchJson(url, {
      headers: {
        Authorization: basicAuthHeader(env.SIM_JENKINS_USER, env.SIM_JENKINS_API_TOKEN),
        Accept: "application/json",
        // ngrok-free serves an interstitial unless we set this.
        "ngrok-skip-browser-warning": "1",
      },
    });
    log.ok(`jenkins reachable (${meta.mode || "unknown"} mode)`);
  } catch (e) {
    if (e.status === 401) {
      log.err(`jenkins auth failed (401). Check SIM_JENKINS_USER + SIM_JENKINS_API_TOKEN.`);
    } else {
      log.err(`jenkins preflight failed: ${e.message}`);
    }
    throw e;
  }
}

// Cached during preflight so we don't ask Jenkins on every trigger.
// `null` = unknown, `true`/`false` = answered.
let _jobIsParameterized = null;

/**
 * Ask Jenkins whether the job declares any parameters. If yes, we use
 * /buildWithParameters and the variant env vars take effect. If no,
 * /buildWithParameters returns HTTP 400 "is not parameterized" and we
 * have to fall back to /build (variants are silently dropped — the
 * Jenkinsfile would need to declare a `parameters { ... }` block for
 * them to be honoured).
 */
async function detectJobParameterized(env) {
  if (_jobIsParameterized !== null) return _jobIsParameterized;
  const url = `${env.SIM_JENKINS_BASE_URL.replace(/\/$/, "")}/job/${env.SIM_JENKINS_JOB}/api/json?tree=property[parameterDefinitions[name]]`;
  try {
    const data = await fetchJson(url, {
      headers: {
        Authorization: basicAuthHeader(env.SIM_JENKINS_USER, env.SIM_JENKINS_API_TOKEN),
        Accept: "application/json",
        "ngrok-skip-browser-warning": "1",
      },
    });
    const props = Array.isArray(data?.property) ? data.property : [];
    _jobIsParameterized = props.some(
      (p) =>
        Array.isArray(p?.parameterDefinitions) &&
        p.parameterDefinitions.length > 0,
    );
    if (!_jobIsParameterized) {
      log.warn(
        `jenkins job "${env.SIM_JENKINS_JOB}" is not parameterized — ` +
          `falling back to /build. Variant env vars (FLAKY_FAIL_RATE, ` +
          `SIMULATE_BROKEN, …) will NOT apply. To restore variance, ` +
          `add a parameters { ... } block to qa-sim-target's Jenkinsfile ` +
          `and run one manual build to register them.`,
      );
    }
    return _jobIsParameterized;
  } catch (e) {
    // If introspection fails we'd rather try the parameterized path
    // and surface the real error per-build than block the whole run.
    log.warn(`couldn't introspect job parameters (${e.message}); assuming parameterized`);
    _jobIsParameterized = true;
    return true;
  }
}

async function triggerBuild(env, variant, idx) {
  const parameterized = await detectJobParameterized(env);

  const params = new URLSearchParams();
  if (parameterized) {
    for (const [k, v] of Object.entries(variant)) params.set(k, v);
    // Identify the source of the build so dashboards can split
    // sim-builds from real ones if we ever care. Only attaches when
    // the job is parameterized — unparameterized jobs ignore extra
    // query params entirely.
    params.set("cause", `sim-qa run ${idx + 1}`);
  }
  if (env.SIM_JENKINS_REMOTE_TOKEN) params.set("token", env.SIM_JENKINS_REMOTE_TOKEN);

  const endpoint = parameterized ? "buildWithParameters" : "build";
  const url = `${env.SIM_JENKINS_BASE_URL.replace(/\/$/, "")}/job/${env.SIM_JENKINS_JOB}/${endpoint}?${params.toString()}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(env.SIM_JENKINS_USER, env.SIM_JENKINS_API_TOKEN),
      "ngrok-skip-browser-warning": "1",
    },
  });
  if (r.status !== 201) {
    const body = await r.text();
    throw new Error(`jenkins build trigger returned ${r.status}: ${body.slice(0, 200)}`);
  }
  return { variant, queueUrl: r.headers.get("Location") };
}

// ─── main ─────────────────────────────────────────────────────────

async function main() {
  loadDotEnv(ENV_PATH);
  const args = parseArgs(process.argv.slice(2));

  // Defaults for env values we want to fall back on.
  process.env.SIM_GH_REPO = process.env.SIM_GH_REPO || "nova-sudo/qa-sim-target";
  process.env.SIM_JENKINS_JOB = process.env.SIM_JENKINS_JOB || "qa-sim-target";
  process.env.SIM_JENKINS_BASE_URL =
    process.env.SIM_JENKINS_BASE_URL || "http://localhost:8080";

  const env = process.env;

  log.head("preflight");

  if (args.dryRun) {
    log.info(`dry-run mode — no API calls will be made`);
    log.info(
      `would create: ${args.tickets} tickets, ${args.prs} PRs, ${args.builds} builds`,
    );
    log.info(
      `repos: jira=${env.SIM_JIRA_URL}, gh=${env.SIM_GH_REPO}, jenkins=${env.SIM_JENKINS_BASE_URL}`,
    );
    return;
  }

  const required = [
    !args.skipTickets && "SIM_JIRA_URL",
    !args.skipTickets && "SIM_JIRA_EMAIL",
    !args.skipTickets && "SIM_JIRA_API_TOKEN",
    !args.skipTickets && "SIM_JIRA_PROJECT_KEY",
    !args.skipBuilds && "SIM_JENKINS_USER",
    !args.skipBuilds && "SIM_JENKINS_API_TOKEN",
  ].filter(Boolean);
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    log.err(`missing env vars: ${missing.join(", ")}`);
    log.info(`add them to ${ENV_PATH} (see script header) and re-run.`);
    process.exit(1);
  }

  if (!args.skipTickets) await preflightJira(env);
  if (!args.skipPrs) preflightGitHub(env);
  if (!args.skipBuilds) await preflightJenkins(env);

  // ─── tickets ──────────────────────────────────────────────────
  const tickets = [];
  if (!args.skipTickets) {
    log.head(`creating ${args.tickets} Jira tickets in ${env.SIM_JIRA_PROJECT_KEY}`);
    for (let i = 0; i < args.tickets; i++) {
      const tpl = pick(TICKET_TEMPLATES, i);
      try {
        const t = await createTicket(env, tpl);
        tickets.push(t);
        log.ok(`  ${t.key} — ${t.summary}`);
      } catch (e) {
        log.warn(`  failed to create ticket ${i + 1}: ${e.message}`);
      }
    }
  }

  // ─── PRs ──────────────────────────────────────────────────────
  const prs = [];
  if (!args.skipPrs && tickets.length > 0) {
    log.head(`opening ${args.prs} PRs on ${env.SIM_GH_REPO}`);
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "sim-qa-"));
    try {
      for (let i = 0; i < args.prs; i++) {
        const tpl = pick(PR_TEMPLATES, i);
        const ticket = tickets[i % tickets.length];
        try {
          const pr = createPr(env, tpl, ticket.key, tmpRoot);
          prs.push(pr);
          log.ok(`  ${pr.url}`);
        } catch (e) {
          log.warn(`  failed to open PR ${i + 1}: ${e.message}`);
        }
      }
    } finally {
      // Always clean up clones — they're transient.
      try {
        rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  } else if (!args.skipPrs && tickets.length === 0) {
    log.warn(`skipping PRs because no tickets were created to link them to`);
  }

  // ─── Jenkins builds ───────────────────────────────────────────
  let buildsQueued = 0;
  if (!args.skipBuilds) {
    log.head(`triggering ${args.builds} Jenkins builds (${env.SIM_JENKINS_JOB})`);
    for (let i = 0; i < args.builds; i++) {
      const variant = pick(BUILD_VARIANTS, i);
      const label =
        Object.keys(variant).length === 0
          ? "default"
          : Object.entries(variant)
              .map(([k, v]) => `${k}=${v}`)
              .join(",");
      try {
        await triggerBuild(env, variant, i);
        buildsQueued++;
        log.ok(`  build ${i + 1}/${args.builds} queued · ${label}`);
        // Small pause between triggers so Jenkins's queue doesn't
        // collapse 10 builds into 1 via cause-folding. 750ms is
        // enough; tune via SIM_JENKINS_TRIGGER_DELAY_MS.
        const wait = Number(env.SIM_JENKINS_TRIGGER_DELAY_MS || "750");
        if (wait > 0 && i < args.builds - 1) {
          await new Promise((r) => setTimeout(r, wait));
        }
      } catch (e) {
        log.warn(`  build ${i + 1} failed to trigger: ${e.message}`);
      }
    }
  }

  // ─── summary ──────────────────────────────────────────────────
  log.head("done");
  log.info(`tickets created: ${tickets.length}`);
  log.info(`prs opened:      ${prs.length}`);
  log.info(`builds queued:   ${buildsQueued}`);
  log.info(``);
  log.info(`open the QA Hub dashboard + hard-refresh — the BuildPassRate`);
  log.info(`tile should reflect the new builds within a few seconds.`);
}

main().catch((e) => {
  log.err(`fatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
