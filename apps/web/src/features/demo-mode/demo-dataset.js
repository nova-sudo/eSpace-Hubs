/**
 * Deterministic synthetic dataset for demo mode.
 *
 * Generates ~30 PRs spread across the last 90 days with hand-crafted
 * timing shapes so the review-timing section + /reviews page show a
 * full distribution of TTFR / ATTNR / idle values:
 *
 *   - A handful of "fast" PRs (TTFR < 4h, single round, merged in a day)
 *   - A core of "normal" PRs (TTFR ~ 1d, 2-3 rounds over 2-3 days)
 *   - A few "slow" PRs (TTFR > 2d, 3-5 rounds, idle ~ a week)
 *   - "Stuck" PRs (open for weeks, many rounds, never merged)
 *   - "High turnover" PRs (5+ reviewers, many comments)
 *   - "Inbound" PRs (review-requested-of-you, others' work)
 *
 * All timestamps anchor to "now" at module-load so dashboards rendered at
 * different times of day still feel coherent. The whole module is pure
 * (no React) so it can be imported from server routes too if we ever
 * want to demo-mode the API proxy.
 *
 * The PR records mirror the shape `useCombinedMergedSince` returns AFTER
 * the GitHub normalizer has run, and the per-PR `details` mirrors what
 * `githubApi.pullDetails` returns. This means every existing tile / page
 * that consumes those shapes works without modification when fed demo
 * data.
 */

const NOW_MS = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const WEEK = 7 * DAY;

// All commenters except `me` count as reviewers. The roster is wide enough
// (7 names) that the multi-reviewer PRs feel like a real team rather than
// the same 3 people shuffling.
const ME = "you";
const REVIEWERS = [
  "alice.kim",
  "boris.tan",
  "chen.park",
  "dara.ng",
  "eli.rios",
  "farah.s",
  "gus.ojo",
];

const REPOS = [
  { owner: "espace-engineering", name: "payments-platform" },
  { owner: "espace-engineering", name: "ledger-service" },
  { owner: "espace-engineering", name: "console-web" },
  { owner: "espace-engineering", name: "infra-shared" },
  { owner: "espace-engineering", name: "auth-broker" },
  { owner: "espace-engineering", name: "analytics-pipeline" },
  { owner: "espace-engineering", name: "design-system" },
];

/**
 * One blueprint per PR. Express timing in HOURS relative to PR open, so
 * the dataset is readable at a glance and we can shift everything around
 * "now" without touching individual deltas.
 *
 *   `created`    h ago that the PR opened
 *   `mergedAfter`h after open the PR merged (null for still-open)
 *   `comments`   each comment is `{ at: hours after open, by, kind, body, [path,line,diffHunk] }`
 */
const BLUEPRINTS = [
  {
    repo: 0,
    number: 218,
    title: "Idempotency keys for settlement webhook",
    created: 30 * 24,
    mergedAfter: 30 * 24 + 8,
    comments: [
      {
        at: 1.5,
        by: "alice.kim",
        kind: "review",
        body: "Idempotency key needs to survive retries — what about base64-decoding malformed input here?",
        path: "src/webhooks/settlement.ts",
        line: 42,
        diffHunk: lines(
          "@@ -38,6 +38,12 @@ async function handleSettlement(req) {",
          "   const raw = req.body;",
          "-  const id = req.headers['idempotency-key'] ?? cuid();",
          "+  const id = req.headers['idempotency-key'];",
          "+  if (!id) {",
          "+    return res.status(400).json({ error: 'Missing Idempotency-Key' });",
          "+  }",
          "   await store.acquire(id);",
        ),
      },
      {
        at: 4,
        by: ME,
        kind: "issue",
        body: "Good catch — pushed a guard + matching test.",
      },
      {
        at: 5,
        by: "alice.kim",
        kind: "review",
        body: "LGTM. Ship it.",
        path: "src/webhooks/settlement.ts",
        line: 47,
        diffHunk: "@@  -45,3 +47,4 @@\n   await store.acquire(id);\n+  metrics.idempotencyKeyAccepted.inc();\n",
      },
    ],
  },
  {
    repo: 1,
    number: 91,
    title: "Wire Prometheus exporter for queue depth",
    created: 22 * 24,
    mergedAfter: 22 * 24 + 28,
    comments: [
      {
        at: 26,
        by: "boris.tan",
        kind: "issue",
        body: "Why a custom exporter and not the existing /metrics?",
      },
      {
        at: 27,
        by: ME,
        kind: "issue",
        body: "/metrics is HTTP-handler-scoped; queue depth lives in a worker that doesn't bind a port.",
      },
      {
        at: 27.4,
        by: "boris.tan",
        kind: "issue",
        body: "Right. Could we run a tiny pushgateway-style sidecar instead?",
      },
      {
        at: 27.6,
        by: ME,
        kind: "issue",
        body: "Followed up offline — going with the exporter for now, sidecar in a follow-up.",
      },
    ],
  },
  {
    repo: 0,
    number: 222,
    title: "Cache layer for /healthz dependencies",
    created: 18 * 24,
    mergedAfter: 18 * 24 + 4,
    comments: [
      {
        at: 0.8,
        by: "chen.park",
        kind: "review",
        body: "Cache TTL of 30s feels long for healthz — k8s probes go faster than that.",
        path: "src/health.ts",
        line: 14,
        diffHunk: "@@ -10,7 +10,7 @@\n const probeCache = new Map();\n-const TTL_MS = 30_000;\n+const TTL_MS = 5_000;",
      },
      {
        at: 1.5,
        by: ME,
        kind: "issue",
        body: "Dropped to 5s. Still 3x cheaper than uncached.",
      },
      {
        at: 2,
        by: "chen.park",
        kind: "issue",
        body: "Perfect.",
      },
    ],
  },
  {
    repo: 2,
    number: 154,
    title: "Migrate metrics export to OpenTelemetry",
    created: 12 * 24,
    mergedAfter: 12 * 24 + 96,
    comments: [
      {
        at: 18,
        by: "alice.kim",
        kind: "review",
        body: "We need a feature flag here — the OTLP collector isn't enabled in prod yet.",
        path: "src/telemetry/init.ts",
        line: 7,
        diffHunk: lines(
          "@@ -1,5 +1,8 @@",
          "+import { trace } from '@opentelemetry/api';",
          " export function initTelemetry() {",
          "-  if (!process.env.METRICS_ENABLED) return;",
          "+  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;",
        ),
      },
      {
        at: 24,
        by: ME,
        kind: "issue",
        body: "Wired the feature flag — defaults to off in prod, opt-in via env.",
      },
      {
        at: 30,
        by: "boris.tan",
        kind: "review",
        body: "Resource attributes need service.version too — telemetry breaks downstream without it.",
        path: "src/telemetry/init.ts",
        line: 22,
        diffHunk: '@@ -20,4 +22,5 @@\n   resource: new Resource({\n     "service.name": "ledger",\n+    "service.version": process.env.GIT_SHA,\n   }),\n',
      },
      {
        at: 48,
        by: ME,
        kind: "issue",
        body: "Added service.version + git sha. Re-running e2e.",
      },
      {
        at: 72,
        by: "alice.kim",
        kind: "issue",
        body: "Tests green, ship it whenever you're ready.",
      },
    ],
  },
  {
    repo: 3,
    number: 47,
    title: "Spike: feature flag service comparison",
    created: 8 * 24,
    mergedAfter: 8 * 24 + 18,
    comments: [
      {
        at: 12,
        by: "dara.ng",
        kind: "issue",
        body: "Did we evaluate Unleash? Self-hosted matters for our compliance posture.",
      },
      {
        at: 14,
        by: ME,
        kind: "issue",
        body: "Tried it briefly — operationally heavier than LaunchDarkly proxy. Doc updated with notes.",
      },
    ],
  },
  {
    repo: 0,
    number: 230,
    title: "Fix race condition in retry counter increment",
    created: 6 * 24,
    mergedAfter: 6 * 24 + 3,
    comments: [
      {
        at: 0.4,
        by: "boris.tan",
        kind: "review",
        body: "atomic? Yes. Ship.",
        path: "src/retry/counter.ts",
        line: 18,
        diffHunk: "@@ -15,4 +15,4 @@\n-  this.count += 1;\n+  this.count = (this.count + 1) | 0;",
      },
    ],
  },
  {
    repo: 2,
    number: 161,
    title: "Replace deprecated Hapi auth strategy",
    created: 5 * 24,
    mergedAfter: 5 * 24 + 36,
    comments: [
      {
        at: 8,
        by: "chen.park",
        kind: "review",
        body: "JWT secret rotation story?",
        path: "src/auth/strategy.ts",
        line: 33,
      },
      {
        at: 12,
        by: ME,
        kind: "issue",
        body: "We don't rotate today; tracked separately as ESD-198.",
      },
      {
        at: 14,
        by: "alice.kim",
        kind: "review",
        body: "Need to log auth failures with anon trace id — current path is too quiet.",
        path: "src/auth/strategy.ts",
        line: 51,
      },
      {
        at: 22,
        by: ME,
        kind: "issue",
        body: "Added structured failure log + trace id correlation.",
      },
      {
        at: 30,
        by: "alice.kim",
        kind: "issue",
        body: "Approved.",
      },
    ],
  },
  {
    repo: 1,
    number: 99,
    title: "Backoff jitter on settlement retries",
    created: 3 * 24,
    mergedAfter: 3 * 24 + 4,
    comments: [
      {
        at: 1,
        by: "alice.kim",
        kind: "review",
        body: "Use full jitter, not equal jitter — closer to AWS guidance.",
        path: "src/retry/backoff.ts",
        line: 22,
      },
      {
        at: 2,
        by: ME,
        kind: "issue",
        body: "Done.",
      },
    ],
  },
  {
    repo: 0,
    number: 234,
    title: "Add /healthz reason field",
    created: 2 * 24,
    mergedAfter: 2 * 24 + 2,
    comments: [
      {
        at: 1,
        by: "dara.ng",
        kind: "issue",
        body: "+1 — would unblock our observability dashboard.",
      },
    ],
  },
  {
    repo: 2,
    number: 167,
    title: "Drop polyfill for Object.fromEntries",
    created: 36,
    mergedAfter: 39,
    comments: [
      {
        at: 1,
        by: "boris.tan",
        kind: "issue",
        body: "Browser support OK — Node 14+ everywhere?",
      },
      {
        at: 1.5,
        by: ME,
        kind: "issue",
        body: "Yes, min Node is 18. Removing.",
      },
    ],
  },
  // Open / unmerged PRs — show up in /reviews list as "still in flight".
  {
    repo: 3,
    number: 51,
    title: "Refactor terraform modules into composition root",
    created: 14 * 24,
    mergedAfter: null,
    comments: [
      {
        at: 24,
        by: "dara.ng",
        kind: "review",
        body: "Composition root needs to keep workspace separation — staging != prod backend.",
      },
      {
        at: 60,
        by: ME,
        kind: "issue",
        body: "Split into staging/prod sub-modules. Take 2 incoming.",
      },
      {
        at: 96,
        by: "boris.tan",
        kind: "review",
        body: "Plan diff still touches IAM in staging. Block until that's clean.",
      },
      {
        at: 144,
        by: "alice.kim",
        kind: "issue",
        body: "Same — let's pair on this Wednesday.",
      },
    ],
  },
  {
    repo: 1,
    number: 102,
    title: "Stub: ledger-side webhook signing",
    created: 9 * 24,
    mergedAfter: null,
    comments: [
      {
        at: 36,
        by: "chen.park",
        kind: "review",
        body: "Need rotating secret support, not just static.",
        path: "src/webhooks/sign.ts",
        line: 18,
      },
      {
        at: 60,
        by: ME,
        kind: "issue",
        body: "Stalled until we wire up secrets-manager. Will pick up after next sprint.",
      },
    ],
  },
  // High-turnover PR — 5 reviewers, lots of comments.
  {
    repo: 0,
    number: 240,
    title: "RFC: idempotent settlement reconciliation pipeline",
    created: 4 * 24,
    mergedAfter: 4 * 24 + 18,
    comments: [
      { at: 2, by: "alice.kim", kind: "issue", body: "Why use Kafka here vs. SQS? Kafka adds operational cost." },
      { at: 3, by: "boris.tan", kind: "issue", body: "Replay semantics drove the Kafka pick — SQS DLQ replay is ugly." },
      { at: 4, by: "chen.park", kind: "review", body: "Schema versioning isn't covered in the RFC.", path: "docs/rfc/0042-reconciliation.md", line: 87 },
      { at: 5, by: ME, kind: "issue", body: "Schema versioning section incoming, sorry." },
      { at: 8, by: "dara.ng", kind: "issue", body: "What's the rollback story if the pipeline goes wrong mid-day?" },
      { at: 9, by: ME, kind: "issue", body: "Added 'rollback to last good offset' procedure." },
      { at: 11, by: "alice.kim", kind: "review", body: "Needs SLOs section — what's the freshness target?", path: "docs/rfc/0042-reconciliation.md", line: 124 },
      { at: 13, by: ME, kind: "issue", body: "5-minute freshness target documented. Anything else?" },
      { at: 16, by: "alice.kim", kind: "issue", body: "Not from me. LGTM." },
      { at: 17, by: "boris.tan", kind: "issue", body: "+1." },
    ],
  },
  // Speed-merge PR — barely any review needed.
  {
    repo: 2,
    number: 170,
    title: "chore: bump @types/node",
    created: 8,
    mergedAfter: 8.5,
    comments: [
      { at: 0.2, by: "alice.kim", kind: "issue", body: "Trivial. LGTM." },
    ],
  },

  // ── Round 2 expansion (added W2): extend coverage across more repos and
  //    surface more nuance in the review-timing distribution. These mostly
  //    backfill the 60-90d window so the YTD / quarterly chips feel rich.
  {
    repo: 4, // auth-broker
    number: 73,
    title: "Rotate JWT signing keys with overlap window",
    created: 60 * 24,
    mergedAfter: 60 * 24 + 14,
    comments: [
      { at: 1, by: "eli.rios", kind: "review", body: "Need a pgp-sealed audit log of every rotation event.", path: "src/jwt/rotate.ts", line: 41 },
      { at: 4, by: ME, kind: "issue", body: "Audit log added; emits structured event per rotation." },
      { at: 8, by: "alice.kim", kind: "review", body: "Overlap window of 24h is fine for prod but staging needs longer for our integration tests.", path: "src/jwt/config.ts", line: 12 },
      { at: 11, by: ME, kind: "issue", body: "Per-env config — staging defaults to 7d." },
      { at: 13, by: "alice.kim", kind: "issue", body: "Approved." },
    ],
  },
  {
    repo: 5, // analytics-pipeline
    number: 412,
    title: "Backfill funnel-step events from raw logs (v3)",
    created: 55 * 24,
    mergedAfter: 55 * 24 + 72,
    comments: [
      { at: 12, by: "farah.s", kind: "review", body: "Backfill window of 30d means we lose Q1 data — can we extend?" },
      { at: 16, by: ME, kind: "issue", body: "Storage cost goes up ~3x for 90d; ran the numbers, still cheaper than the lost-funnel ticket." },
      { at: 18, by: "farah.s", kind: "issue", body: "Got it. Approve from data side." },
      { at: 30, by: "boris.tan", kind: "review", body: "Idempotency for replays — what if backfill runs overlap?", path: "src/backfill/runner.ts", line: 88 },
      { at: 36, by: ME, kind: "issue", body: "Wrote a per-event dedupe key (event_id + funnel_step + day). Re-running is a no-op." },
      { at: 48, by: "chen.park", kind: "review", body: "Add metrics for backfill rate so we can SLO it.", path: "src/backfill/runner.ts", line: 124 },
      { at: 60, by: ME, kind: "issue", body: "metrics.backfill.events_per_minute + dropped_count." },
      { at: 70, by: "chen.park", kind: "issue", body: "All good." },
    ],
  },
  {
    repo: 6, // design-system
    number: 38,
    title: "Tokens: introduce semantic spacing scale",
    created: 48 * 24,
    mergedAfter: 48 * 24 + 6,
    comments: [
      { at: 0.5, by: "dara.ng", kind: "review", body: "Naming: prefer `space.lg` over `space.l` to avoid collision with line-height scale.", path: "tokens/spacing.json", line: 4 },
      { at: 1, by: ME, kind: "issue", body: "Renamed across the board." },
      { at: 3, by: "dara.ng", kind: "issue", body: "Ship it." },
    ],
  },
  {
    repo: 4,
    number: 79,
    title: "Add device-fingerprint guard to login flow",
    created: 42 * 24,
    mergedAfter: 42 * 24 + 96,
    comments: [
      { at: 18, by: "eli.rios", kind: "review", body: "Fingerprint should be salted per-tenant, not per-user.", path: "src/auth/fp.ts", line: 22 },
      { at: 24, by: ME, kind: "issue", body: "Reworked salt scheme — per-tenant + per-user composite." },
      { at: 36, by: "eli.rios", kind: "review", body: "GDPR review: this is now PII. Need to document retention.", path: "docs/auth/fingerprinting.md" },
      { at: 60, by: ME, kind: "issue", body: "Doc + 90d retention enforced via cron job. Awaiting privacy team sign-off." },
      { at: 72, by: "alice.kim", kind: "issue", body: "Privacy approved offline." },
      { at: 84, by: "eli.rios", kind: "issue", body: "LGTM." },
    ],
  },
  {
    repo: 0,
    number: 248,
    title: "Settlement reconciliation v1 (impl)",
    created: 36 * 24,
    mergedAfter: 36 * 24 + 60,
    comments: [
      { at: 8, by: "alice.kim", kind: "review", body: "Pipeline tap point — please add a feature flag.", path: "src/recon/pipeline.ts", line: 14 },
      { at: 12, by: ME, kind: "issue", body: "Flag added. Default off in prod." },
      { at: 18, by: "boris.tan", kind: "review", body: "What's the retry semantics if a single batch fails?", path: "src/recon/batch.ts", line: 67 },
      { at: 24, by: ME, kind: "issue", body: "Exponential backoff with max 3 retries per batch; full failure pages on-call." },
      { at: 36, by: "alice.kim", kind: "issue", body: "Approved." },
      { at: 42, by: "boris.tan", kind: "issue", body: "Approved." },
    ],
  },
  {
    repo: 2,
    number: 178,
    title: "Refactor Settings → Account tab into smaller components",
    created: 28 * 24,
    mergedAfter: 28 * 24 + 4,
    comments: [
      { at: 0.6, by: "dara.ng", kind: "review", body: "We can drop the wrapper Card here — already inside one.", path: "src/features/settings/tabs/account-tab.jsx", line: 10 },
      { at: 1.2, by: ME, kind: "issue", body: "Done." },
      { at: 2, by: "dara.ng", kind: "issue", body: "Ship." },
    ],
  },
  {
    repo: 3,
    number: 56,
    title: "Migrate observability stack from Datadog to Grafana Cloud",
    created: 24 * 24,
    mergedAfter: null, // still open
    comments: [
      { at: 24, by: "boris.tan", kind: "review", body: "What's the rollback plan if Grafana ingests less than expected?" },
      { at: 36, by: ME, kind: "issue", body: "Dual-publishing during migration; Datadog stays warm for 30d after cutover." },
      { at: 60, by: "alice.kim", kind: "review", body: "Cost projection — does this actually save us money or is it lateral?" },
      { at: 72, by: ME, kind: "issue", body: "Spreadsheet attached. Net ~28% over 12mo, larger savings if we drop log volume by 40%." },
      { at: 96, by: "gus.ojo", kind: "issue", body: "Need finance sign-off before merge — pinged Sara." },
    ],
  },
  {
    repo: 5,
    number: 419,
    title: "Add cohort-retention chart to analytics dashboard",
    created: 21 * 24,
    mergedAfter: 21 * 24 + 30,
    comments: [
      { at: 4, by: "farah.s", kind: "review", body: "Cohort definition — weekly or monthly? PM expects monthly.", path: "src/charts/retention.ts", line: 8 },
      { at: 6, by: ME, kind: "issue", body: "Default monthly; weekly available via prop." },
      { at: 12, by: "dara.ng", kind: "review", body: "Color scale doesn't pass contrast — use the new tokens.", path: "src/charts/retention.ts", line: 84 },
      { at: 18, by: ME, kind: "issue", body: "Switched to design-system tokens." },
      { at: 24, by: "farah.s", kind: "issue", body: "Approved." },
    ],
  },
  {
    repo: 0,
    number: 251,
    title: "Hotfix: settlement webhook timeout race",
    created: 19 * 24,
    mergedAfter: 19 * 24 + 0.6,
    comments: [
      { at: 0.3, by: "alice.kim", kind: "issue", body: "Hotfix-approved on-call. Merging." },
    ],
  },
  {
    repo: 1,
    number: 108,
    title: "Ledger: persist FX rate snapshots per-transaction",
    created: 16 * 24,
    mergedAfter: 16 * 24 + 18,
    comments: [
      { at: 4, by: "boris.tan", kind: "review", body: "Why per-transaction and not per-batch? Storage adds up.", path: "src/ledger/fx.ts", line: 30 },
      { at: 6, by: ME, kind: "issue", body: "Per-transaction is the audit requirement; FX desk pushed back when we batched in v0." },
      { at: 8, by: "boris.tan", kind: "issue", body: "Acknowledged. Would still like a TTL on the column long-term." },
      { at: 14, by: ME, kind: "issue", body: "Filed ESD-241 for TTL work; out of scope here." },
      { at: 16, by: "boris.tan", kind: "issue", body: "OK to ship." },
    ],
  },
  {
    repo: 6,
    number: 44,
    title: "Pill: add `tone` prop with full token coverage",
    created: 11 * 24,
    mergedAfter: 11 * 24 + 4,
    comments: [
      { at: 0.4, by: "dara.ng", kind: "review", body: "Storybook story for each tone, please.", path: "src/components/Pill.stories.tsx" },
      { at: 1.5, by: ME, kind: "issue", body: "Stories added; visual regression passes." },
      { at: 3, by: "chen.park", kind: "issue", body: "LGTM." },
    ],
  },
  {
    repo: 4,
    number: 86,
    title: "Session-revoke endpoint + admin UI",
    created: 10 * 24,
    mergedAfter: 10 * 24 + 26,
    comments: [
      { at: 6, by: "eli.rios", kind: "review", body: "Endpoint is missing rate limiting — admin actions are juicy targets.", path: "src/api/sessions.ts", line: 51 },
      { at: 9, by: ME, kind: "issue", body: "Per-admin rate limit (60/min) added." },
      { at: 14, by: "gus.ojo", kind: "review", body: "Audit-log this with the admin's identity, not the session being revoked.", path: "src/api/sessions.ts", line: 64 },
      { at: 18, by: ME, kind: "issue", body: "Audit shape clarified — actor + target separately." },
      { at: 22, by: "eli.rios", kind: "issue", body: "Ship." },
    ],
  },
  {
    repo: 1,
    number: 117,
    title: "Stub: ledger event-sourcing read model",
    created: 7 * 24,
    mergedAfter: null, // still open — exploratory
    comments: [
      { at: 24, by: "boris.tan", kind: "review", body: "RFC-style PR — should we move this to a doc and gate the actual code on the RFC?" },
      { at: 36, by: ME, kind: "issue", body: "Reasonable. Closing the impl side, will reopen after RFC lands." },
      { at: 48, by: "alice.kim", kind: "issue", body: "Once you have the doc, ping me — happy to review." },
    ],
  },
  {
    repo: 2,
    number: 184,
    title: "Onboarding: 3-step token entry wizard",
    created: 5 * 24,
    mergedAfter: 5 * 24 + 12,
    comments: [
      { at: 2, by: "dara.ng", kind: "review", body: "Each step should pre-validate the token before letting the user advance.", path: "src/features/onboarding/steps.tsx", line: 22 },
      { at: 4, by: ME, kind: "issue", body: "Pre-validate via the integrations proxy — happy path takes ~400ms." },
      { at: 8, by: "chen.park", kind: "review", body: "Loading state is missing on the validate call.", path: "src/features/onboarding/steps.tsx", line: 38 },
      { at: 10, by: ME, kind: "issue", body: "Spinner + disabled-button state added." },
      { at: 11, by: "dara.ng", kind: "issue", body: "LGTM." },
    ],
  },
  {
    repo: 3,
    number: 64,
    title: "Add `terraform validate` to CI",
    created: 4 * 24,
    mergedAfter: 4 * 24 + 1.5,
    comments: [
      { at: 0.5, by: "gus.ojo", kind: "issue", body: "Was overdue. Approving." },
    ],
  },
  {
    repo: 5,
    number: 425,
    title: "Use cuid2 for event ids (was: timestamp-based)",
    created: 3 * 24,
    mergedAfter: 3 * 24 + 5,
    comments: [
      { at: 1, by: "farah.s", kind: "review", body: "Backwards-compat? Existing events still use the old shape.", path: "src/events/id.ts", line: 11 },
      { at: 2, by: ME, kind: "issue", body: "Dual-read at query time; new writes use cuid2 from now." },
      { at: 4, by: "farah.s", kind: "issue", body: "Ship." },
    ],
  },
  // One more high-stakes PR opened recently — keeps "this week's idle" big.
  {
    repo: 0,
    number: 263,
    title: "RFC + impl: backpressure for downstream PSP queue",
    created: 36,
    mergedAfter: null, // open, very recent
    comments: [
      { at: 6, by: "alice.kim", kind: "review", body: "Backpressure semantics: drop or block? Dropping silently scares me.", path: "src/queue/psp.ts", line: 18 },
      { at: 12, by: ME, kind: "issue", body: "Currently block + emit metric. Will add explicit drop policy if PSP latency spikes." },
      { at: 24, by: "boris.tan", kind: "issue", body: "+1 to block. Drop should be opt-in via flag." },
    ],
  },

  // ── Round 3 — fresh activity for "this-week" & "today" presets ──────
  // Mostly under 7 days old. Mix of merged, open, idle (no reviewers
  // yet), commented-but-unresolved, and a couple of speed merges.
  // Today — fresh, just merged, single review.
  {
    repo: 4, // auth-broker
    number: 92,
    title: "Surface OAuth scope mismatch as a typed error",
    created: 14,
    mergedAfter: 16,
    comments: [
      {
        at: 1,
        by: "eli.rios",
        kind: "review",
        body: "Don't expose the requested-vs-granted diff in the error message — leaks scope shape.",
        path: "src/auth/oauth.ts",
        line: 88,
        diffHunk: "@@ -85,4 +88,7 @@\n-  throw new Error(`Wanted ${wanted}; got ${granted}`);\n+  throw new ScopeError({ requestedHash: hash(wanted) });",
      },
      { at: 2, by: ME, kind: "issue", body: "Hashed both sides; error now carries an opaque marker." },
      { at: 2.5, by: "eli.rios", kind: "issue", body: "Approved." },
    ],
  },
  // Today — opened a few hours ago, ZERO comments yet (idle / fresh).
  {
    repo: 5, // analytics-pipeline
    number: 431,
    title: "WIP: streaming aggregator for funnel-step rates",
    created: 4,
    mergedAfter: null,
    comments: [],
  },
  // Yesterday — small chore, merged in under an hour.
  {
    repo: 6, // design-system
    number: 51,
    title: "Bars: align baseline when sparkline + value share a row",
    created: 26,
    mergedAfter: 27,
    comments: [
      { at: 0.4, by: "dara.ng", kind: "issue", body: "Easy. LGTM." },
    ],
  },
  // 2 days ago — merged with one round of review.
  {
    repo: 0, // payments-platform
    number: 270,
    title: "Surface settlement webhook signature failures in /healthz",
    created: 50,
    mergedAfter: 56,
    comments: [
      {
        at: 4,
        by: "boris.tan",
        kind: "review",
        body: "Surface as `degraded` not `down` — sig failures don't necessarily kill the host.",
        path: "src/health.ts",
        line: 38,
      },
      { at: 5, by: ME, kind: "issue", body: "Switched to degraded; counter resets per-deploy." },
      { at: 5.5, by: "boris.tan", kind: "issue", body: "Ship." },
    ],
  },
  // 3 days ago — merged, multi-round review with a senior + a peer.
  {
    repo: 1, // ledger-service
    number: 124,
    title: "Add monotonic ledger sequence number per account",
    created: 3 * 24,
    mergedAfter: 3 * 24 + 14,
    comments: [
      {
        at: 4,
        by: "alice.kim",
        kind: "review",
        body: "Monotonic across replicas? If we shard by account this is per-shard, right?",
        path: "src/ledger/seq.ts",
        line: 22,
      },
      { at: 6, by: ME, kind: "issue", body: "Per-account-per-shard. Doc updated to spell that out." },
      {
        at: 8,
        by: "chen.park",
        kind: "review",
        body: "Race when two writers contend for the same account row?",
        path: "src/ledger/seq.ts",
        line: 41,
      },
      { at: 10, by: ME, kind: "issue", body: "Row-level lock + retry on conflict. Stress-tested at 5k QPS." },
      { at: 13, by: "alice.kim", kind: "issue", body: "Approved." },
    ],
  },
  // 3 days ago — opened, has 1 comment, NOT yet merged (idle on you).
  {
    repo: 2, // console-web
    number: 192,
    title: "Move date-range presets into URL state",
    created: 3 * 24 + 4,
    mergedAfter: null,
    comments: [
      {
        at: 6,
        by: "dara.ng",
        kind: "review",
        body: "Validate against the preset list — anything not in the allowlist should fall back to default.",
        path: "src/features/dashboard/date-range/use-date-range.js",
        line: 22,
      },
    ],
  },
  // 4 days ago — opened, has comments but waiting on you (idle on author).
  {
    repo: 5,
    number: 433,
    title: "Add p95 + p99 to funnel-step latency dashboard",
    created: 4 * 24,
    mergedAfter: null,
    comments: [
      {
        at: 8,
        by: "farah.s",
        kind: "review",
        body: "Histogram bucketing — are we using the same bounds as the upstream collector?",
        path: "src/charts/latency.ts",
        line: 14,
      },
      {
        at: 28,
        by: "boris.tan",
        kind: "review",
        body: "Naming: `p95Hour` reads weird; prefer `latencyP95Hour` for grep.",
        path: "src/charts/latency.ts",
        line: 27,
      },
    ],
  },
  // 5 days ago — speed merge, single LGTM.
  {
    repo: 6,
    number: 56,
    title: "Pill: drop the `inverse` variant — accent-dim handles it",
    created: 5 * 24,
    mergedAfter: 5 * 24 + 1.5,
    comments: [
      { at: 0.5, by: "dara.ng", kind: "issue", body: "Cleanup. Approved." },
    ],
  },
  // 6 days ago — merged with reviewer concerns flagged & resolved.
  {
    repo: 4,
    number: 95,
    title: "Rate-limit /auth/sessions/revoke per actor",
    created: 6 * 24,
    mergedAfter: 6 * 24 + 12,
    comments: [
      {
        at: 4,
        by: "eli.rios",
        kind: "review",
        body: "60/min per actor seems high for an admin op. Why not 10/min?",
        path: "src/api/sessions.ts",
        line: 70,
      },
      { at: 6, by: ME, kind: "issue", body: "Dropped to 10/min. Audit log emits when limit hit." },
      {
        at: 10,
        by: "gus.ojo",
        kind: "review",
        body: "Worth adding a metric for limit-hit events so we can SLO it.",
        path: "src/api/sessions.ts",
        line: 84,
      },
      { at: 11, by: ME, kind: "issue", body: "metrics.session_revoke.rate_limit_hit added." },
      { at: 11.5, by: "eli.rios", kind: "issue", body: "Ship." },
    ],
  },
];

function lines(...l) {
  return l.join("\n");
}

/**
 * Resolve `(createdMs, mergedMs)` for a blueprint.
 *
 * Convention used by every blueprint above:
 *   `created`     — hours-ago when the PR opened (e.g. 30 * 24 = 30 days ago).
 *   `mergedAfter` — written as `bp.created + N` where N is hours-after-open.
 *                   So `mergedAfter - created` is the actual delta. This is
 *                   slightly counter-intuitive but matches the existing data
 *                   shape: every entry that says `mergedAfter: 30*24 + 8`
 *                   means "this PR opened 30 days ago and merged 8 hours
 *                   later", i.e. it merged ~29.7 days ago.
 *
 * Earlier this function used `NOW - (created - mergedAfter) * H`, which
 * algebraically came out to NOW + N hours (i.e. a merge timestamp in the
 * future) — that silently broke every range-filtered tile (Merged, Rounds,
 * Linkage, Turnaround, Activity) because their `splitByRange` cap is
 * `range.end = now`. Fixed by deriving the delta explicitly and adding it
 * to the open time.
 */
function timestampsFor(bp) {
  const createdMs = NOW_MS - bp.created * HOUR;
  if (bp.mergedAfter == null) return { createdMs, mergedMs: null };
  const deltaHours = bp.mergedAfter - bp.created;
  const mergedMs = createdMs + deltaHours * HOUR;
  return { createdMs, mergedMs };
}

/**
 * Generate the demo PR list (the shape `useCombinedMergedSince` returns).
 */
export function buildDemoPrs() {
  return BLUEPRINTS.map((bp) => {
    const repo = REPOS[bp.repo];
    const { createdMs, mergedMs } = timestampsFor(bp);
    const id = `gh-demo-${bp.number}`;
    const url = `https://github.com/${repo.owner}/${repo.name}/pull/${bp.number}`;
    return {
      id,
      iid: bp.number,
      number: bp.number,
      title: bp.title,
      // ~85% of PRs reference a Jira key in the description so the
      // LinkageTile reads ~85% (realistic team-discipline number).
      // Deterministic: every PR with `number % 7 !== 0` is "linked".
      description: hasLinkage(bp.number) ? linkageBody(bp.number) : "",
      source_branch: "",
      created_at: new Date(createdMs).toISOString(),
      merged_at: mergedMs ? new Date(mergedMs).toISOString() : null,
      user_notes_count: bp.comments.length,
      web_url: url,
      source: "github",
    };
  });
}

function hasLinkage(prNumber) {
  // 6/7 (~85%) PRs are "linked" to a tracker key. The remainder are
  // "loose" so the LinkageTile shows a plausible-looking percentage and
  // a non-zero "Orphans" count.
  return prNumber % 7 !== 0;
}

function linkageBody(prNumber) {
  // Stable mapping PR number → ESD-NNN. Keeps the tracker keys reading
  // realistic and prevents the same key showing up on every PR.
  const ticket = 200 + (prNumber % 80);
  return `Tracks ESD-${ticket}.\n\nDemo PR — synthetic dataset.`;
}

/**
 * Generate per-PR details (the shape `githubApi.pullDetails` returns).
 * Returned as a Map keyed by PR id so the timing hook can look up
 * synchronously without an async fetch.
 */
export function buildDemoDetailsMap() {
  const map = new Map();
  BLUEPRINTS.forEach((bp) => {
    const repo = REPOS[bp.repo];
    const id = `gh-demo-${bp.number}`;
    const { createdMs, mergedMs } = timestampsFor(bp);
    const comments = bp.comments.map((c, i) => ({
      id: 100_000 + bp.number * 100 + i,
      user: c.by,
      body: c.body,
      kind: c.kind,
      createdAt: new Date(createdMs + c.at * HOUR).toISOString(),
      htmlUrl: `https://github.com/${repo.owner}/${repo.name}/pull/${bp.number}#discussion_r${i}`,
      path: c.path || null,
      line: c.line ?? null,
      position: null,
      diffHunk: c.diffHunk || "",
      commitId: null,
    }));
    map.set(id, {
      title: bp.title,
      body: bp.description || demoPrBody(bp),
      state: bp.mergedAfter != null ? "merged" : "open",
      author: ME,
      createdAt: new Date(createdMs).toISOString(),
      mergedAt: mergedMs ? new Date(mergedMs).toISOString() : null,
      htmlUrl: `https://github.com/${repo.owner}/${repo.name}/pull/${bp.number}`,
      baseRef: "main",
      headRef: `feat/${bp.number}`,
      comments,
    });
  });
  return map;
}

function demoPrBody(bp) {
  return [
    `## Context`,
    `${bp.title}.`,
    "",
    `## Approach`,
    `See diff. Demo data — synthesized for the dashboard's review-timing flow.`,
  ].join("\n");
}

/**
 * Generate "events" — used by the activity heatmap, reviews-given count,
 * and recent-commits tile. We synthesise three event types per PR:
 *   - `pushed to` (the author's commits leading up to merge)
 *   - `commented on` (every reviewer comment becomes one of these)
 *   - `merged` (one per merged PR)
 * Plus some standalone push events so the heatmap looks active even on
 * days without PR activity.
 */
export function buildDemoEvents() {
  const events = [];
  const details = buildDemoDetailsMap();
  for (const bp of BLUEPRINTS) {
    const repo = REPOS[bp.repo];
    const { createdMs, mergedMs } = timestampsFor(bp);
    // 2-4 author pushes leading up to merge / now.
    const pushCount = 2 + (bp.number % 3);
    // Span the pushes across the actual open-to-merge window (or
    // open-to-now for still-open PRs). Earlier this used `bp.mergedAfter`
    // raw, which under the absolute-style convention came out to "open
    // duration + days" — so pushes ended up scattered across 30+ days.
    const spanMs =
      mergedMs != null
        ? mergedMs - createdMs
        : NOW_MS - createdMs;
    for (let i = 0; i < pushCount; i++) {
      events.push({
        created_at: new Date(createdMs + ((i + 1) / (pushCount + 1)) * spanMs).toISOString(),
        action_name: "pushed to",
        target_type: null,
        repo_name: `${repo.owner}/${repo.name}`,
        source: "github",
        push_data: {
          commit_title: pushTitle(bp.title, i),
          commit_from: sha(bp.number, i),
          commit_to: sha(bp.number, i + 1),
          commit_count: 1,
          ref: "refs/heads/main",
        },
      });
    }
    // Each reviewer comment is an "MR comment" event.
    const detail = details.get(`gh-demo-${bp.number}`);
    for (const c of detail.comments) {
      if (c.user === ME) continue; // author replies don't count as reviews-given
      events.push({
        created_at: c.createdAt,
        action_name: "commented on",
        target_type: "MergeRequest",
        repo_name: `${repo.owner}/${repo.name}`,
        source: "github",
      });
    }
    // Merge event — uses the same correct timestamp as the PR list.
    if (mergedMs != null) {
      events.push({
        created_at: new Date(mergedMs).toISOString(),
        action_name: "pushed to",
        target_type: null,
        repo_name: `${repo.owner}/${repo.name}`,
        source: "github",
        push_data: {
          commit_title: `merged #${bp.number}: ${bp.title}`,
          commit_from: sha(bp.number, pushCount),
          commit_to: sha(bp.number, pushCount + 1),
          commit_count: 1,
          ref: "refs/heads/main",
        },
      });
    }
  }
  // Sprinkle ambient pushes across the FULL 90-day window so the heatmap
  // looks active even on days without PR activity. Sun-Thu work-week
  // shape (skip Fri/Sat = days 5/6) — matches the team's actual cadence.
  // Density varies by week-day so the heatmap has visible texture rather
  // than a uniform wash.
  for (let d = 0; d < 90; d++) {
    const weekday = d % 7; // 0 = today's-day-of-week, 6 = …
    if (weekday === 5 || weekday === 6) continue; // skip Fri/Sat in the work-week
    const dayStart = NOW_MS - d * DAY - 6 * HOUR;
    // Mid-week is denser than Sunday/Thursday tails, with a small random
    // wobble so days don't all look identical.
    const dayOfWeekDensity = [2, 4, 5, 4, 3][weekday] || 2;
    const wobble = ((d * 11) % 3) - 1; // -1, 0, or 1
    const dayBursts = Math.max(1, dayOfWeekDensity + wobble);
    for (let i = 0; i < dayBursts; i++) {
      const repoIdx = (d * 3 + i) % REPOS.length;
      events.push({
        created_at: new Date(dayStart + i * 75 * MINUTE).toISOString(),
        action_name: "pushed to",
        target_type: null,
        repo_name: `${REPOS[repoIdx].owner}/${REPOS[repoIdx].name}`,
        source: "github",
        push_data: {
          commit_title: ambientTitle(d, i),
          commit_from: sha(1000 + d, i),
          commit_to: sha(1000 + d, i + 1),
          commit_count: 1 + ((d + i) % 4), // 1-4 commits per push
          ref: "refs/heads/main",
        },
      });
    }
  }
  return events.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function pushTitle(prTitle, i) {
  const verbs = ["wip", "address review", "rebase", "fix tests", "polish"];
  return `${verbs[i % verbs.length]}: ${prTitle.slice(0, 56)}`;
}

function ambientTitle(d, i) {
  const verbs = [
    "Refactor metrics flush",
    "Bump dependencies",
    "Fix flaky integration test",
    "Document deploy runbook",
    "Tidy logging shape",
    "Trim dead code path",
    "Inline small helper",
    "Update README badges",
    "Address lint warning",
    "Replace any-type with unknown",
    "Add jsdoc to public surface",
    "Cache hot path lookup",
    "Drop unused import",
    "Pin npm engine field",
    "Adjust CI matrix",
    "Trim test fixture",
    "Reorder boot sequence",
    "Simplify retry helper",
    "Promote constant out of fn",
    "Add tracing span",
  ];
  return verbs[(d + i) % verbs.length];
}

function sha(seedA, seedB) {
  // Deterministic 7-char "sha-like" hex. Not a real hash — purely cosmetic.
  const n = (seedA * 7919 + seedB * 31) >>> 0;
  return n.toString(16).padStart(7, "0").slice(0, 7);
}

/**
 * Demo Jira tickets — 6 in the kanban so the Tickets tile looks alive
 * in demo mode.
 *
 * Each Jira status has TWO levels of categorisation. The tile groups by
 * the canonical `statusCategory.key` (one of `new` / `indeterminate` /
 * `done`) which is stable across custom workflows; the human-readable
 * `name` is only used for display. Demo data has to carry BOTH so the
 * downstream `groupByCategory` reducer hits the right bucket.
 */
const JIRA_CATEGORIES = {
  // To Do / Backlog → "new"
  new: { key: "new", name: "To Do" },
  // In Progress / In Review → "indeterminate"
  indeterminate: { key: "indeterminate", name: "In Progress" },
  // Done / Resolved / Closed → "done"
  done: { key: "done", name: "Done" },
};

export function buildDemoTickets() {
  // 14 tickets — denser than the previous 6 — with realistic status mix:
  // 5 Done (recently shipped), 5 In Progress / Review, 4 To Do / Backlog.
  // Mix of priorities + due dates so the kanban cards look varied.
  const issues = [
    // ── Done (recent wins, ordered roughly oldest-first) ───────────────
    {
      key: "ESD-201",
      summary: "Idempotency keys for settlement webhook",
      categoryKey: "done",
      statusName: "Done",
      priority: "High",
      due: 32,
    },
    {
      key: "ESD-204",
      summary: "Wire Prometheus exporter for queue depth",
      categoryKey: "done",
      statusName: "Done",
      priority: "Medium",
      due: 22,
    },
    {
      key: "ESD-209",
      summary: "Cache layer for /healthz dependency probes",
      categoryKey: "done",
      statusName: "Done",
      priority: "Low",
      due: 16,
    },
    {
      key: "ESD-225",
      summary: "Backfill funnel-step events from raw logs",
      categoryKey: "done",
      statusName: "Done",
      priority: "Medium",
      due: 8,
    },
    {
      key: "ESD-238",
      summary: "Add cohort retention chart to analytics dash",
      categoryKey: "done",
      statusName: "Done",
      priority: "Medium",
      due: 3,
    },
    // ── In Progress / In Review ─────────────────────────────────────────
    {
      key: "ESD-211",
      summary: "Refactor terraform composition root",
      categoryKey: "indeterminate",
      statusName: "In Progress",
      priority: "High",
      due: 5,
    },
    {
      key: "ESD-214",
      summary: "Ledger-side webhook signing (stub → impl)",
      categoryKey: "indeterminate",
      statusName: "In Review",
      priority: "High",
      due: 2,
    },
    {
      key: "ESD-227",
      summary: "Migrate observability stack to Grafana Cloud",
      categoryKey: "indeterminate",
      statusName: "In Progress",
      priority: "Medium",
      due: -4,
    },
    {
      key: "ESD-241",
      summary: "TTL on FX rate snapshots column (followup)",
      categoryKey: "indeterminate",
      statusName: "In Progress",
      priority: "Low",
      due: -8,
    },
    {
      key: "ESD-244",
      summary: "Backpressure for downstream PSP queue",
      categoryKey: "indeterminate",
      statusName: "In Review",
      priority: "High",
      due: -1,
    },
    // ── To Do / Backlog ────────────────────────────────────────────────
    {
      key: "ESD-218",
      summary: "Add /healthz reason field",
      categoryKey: "new",
      statusName: "To Do",
      priority: "Medium",
      due: -5,
    },
    {
      key: "ESD-220",
      summary: "Spike: feature-flag service comparison",
      categoryKey: "new",
      statusName: "Backlog",
      priority: "Low",
      due: -14,
    },
    {
      key: "ESD-247",
      summary: "Rotate JWT signing keys with overlap window",
      categoryKey: "new",
      statusName: "To Do",
      priority: "High",
      due: -7,
    },
    {
      key: "ESD-252",
      summary: "Document deploy-runbook for analytics-pipeline",
      categoryKey: "new",
      statusName: "Backlog",
      priority: "Low",
      due: -21,
    },
    // ── Round 3 — fresh recent activity ──────
    {
      key: "ESD-256",
      summary: "OAuth scope mismatch surfaces typed error",
      categoryKey: "done",
      statusName: "Done",
      priority: "Medium",
      due: 1,
    },
    {
      key: "ESD-258",
      summary: "Streaming aggregator for funnel-step rates",
      categoryKey: "indeterminate",
      statusName: "In Progress",
      priority: "High",
      due: -2,
    },
    {
      key: "ESD-261",
      summary: "Settlement webhook signature failures in /healthz",
      categoryKey: "done",
      statusName: "Done",
      priority: "Medium",
      due: 2,
    },
    {
      key: "ESD-264",
      summary: "Move date-range presets into URL state",
      categoryKey: "indeterminate",
      statusName: "In Review",
      priority: "Medium",
      due: -3,
    },
    {
      key: "ESD-267",
      summary: "Audit-log replay + retention policy",
      categoryKey: "new",
      statusName: "To Do",
      priority: "High",
      due: -10,
    },
  ];
  return {
    issues: issues.map((it, idx) => ({
      // Realistic Jira numeric id; downstream code keys on `key` anyway,
      // but `id` is required to satisfy components that use it as a React key.
      id: `demo-jira-${10000 + idx}`,
      key: it.key,
      fields: {
        summary: it.summary,
        status: {
          // Top-level human-readable name shown on the card
          name: it.statusName,
          // Canonical category — what the kanban bucketing reads
          statusCategory: JIRA_CATEGORIES[it.categoryKey],
        },
        priority: { name: it.priority || "Medium" },
        issuetype: { name: "Task" },
        updated: new Date(NOW_MS - (4 + idx) * DAY).toISOString(),
        // `due` is days from now (negative = future). Lets the card show a
        // realistic date stamp instead of all six having the same one.
        duedate:
          it.due != null
            ? new Date(NOW_MS - it.due * DAY).toISOString().slice(0, 10)
            : null,
      },
    })),
  };
}

/**
 * "Review-requested-of-you" PRs — work by other engineers waiting for
 * your review. Different surface from `myOpenPulls()`; the dashboard's
 * Open-PRs / On-your-plate tile renders both buckets.
 *
 * Keeps the same `search/issues` envelope shape so the consumer doesn't
 * need to special-case the demo path. Each entry is a PR opened by a
 * teammate that lists `you` in the requested-reviewers field.
 */
export function buildDemoReviewRequests() {
  const items = [
    {
      number: 88,
      repo: 4, // auth-broker
      title: "Tighten password reset token entropy",
      author: "alice.kim",
      openedHoursAgo: 6,
      comments: 1,
    },
    {
      number: 269,
      repo: 0, // payments-platform
      title: "Add structured-log fields to settlement retry path",
      author: "boris.tan",
      openedHoursAgo: 22,
      comments: 4,
    },
    {
      number: 121,
      repo: 1, // ledger-service
      title: "Refactor: extract `RateProvider` interface",
      author: "chen.park",
      openedHoursAgo: 36,
      comments: 0,
    },
    {
      number: 187,
      repo: 2, // console-web
      title: "Update onboarding copy for OAuth flow",
      author: "dara.ng",
      openedHoursAgo: 60,
      comments: 2,
    },
    {
      number: 47,
      repo: 6, // design-system
      title: "Sparkline: support area-fill prop",
      author: "farah.s",
      openedHoursAgo: 84,
      comments: 1,
    },
  ];
  return {
    items: items.map((it) => {
      const repo = REPOS[it.repo];
      const url = `https://github.com/${repo.owner}/${repo.name}/pull/${it.number}`;
      const created = new Date(NOW_MS - it.openedHoursAgo * HOUR).toISOString();
      return {
        id: 700_000 + it.number,
        number: it.number,
        title: it.title,
        html_url: url,
        state: "open",
        comments: it.comments,
        created_at: created,
        user: { login: it.author },
        pull_request: { html_url: url },
        repository_url: `https://api.github.com/repos/${repo.owner}/${repo.name}`,
      };
    }),
  };
}

/**
 * 14 weeks of synthetic snapshots ending last Sunday — gives the
 * Snapshots page a real-looking trend the moment demo mode is enabled,
 * and makes the Compare-snapshots flow demoable without hand-capturing.
 *
 * The trend has shape: gentle rise with one dip in the middle (week 7-8)
 * and a recovery, so the trend chart actually says something.
 */
export function buildDemoSnapshots() {
  const out = [];

  // Anchor every snapshot at Jan 1 of the current year. Walk forward
  // one Sun-Thu work-week at a time until we run out of completed
  // weeks. "Completed" means the week's Friday has passed, i.e. it's
  // older than ~5 days from now. The current in-progress week is left
  // off — only the auto-snapshotter (or backfill for real users) will
  // close it.
  const yearStart = new Date(NOW_MS);
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);

  // Find the first Sunday on or after Jan 1. If Jan 1 is a Sunday it's
  // the anchor; otherwise step forward to the next Sunday so we don't
  // capture a partial pre-Jan-1 week.
  const firstSunday = new Date(yearStart);
  while (firstSunday.getDay() !== 0) {
    firstSunday.setDate(firstSunday.getDate() + 1);
  }

  // Build a list of Sun→Thu completed weeks. A week ends on Friday at
  // 00:00 (= Thu EOD). Stop when the Friday end-time would be in the
  // future.
  const completedWeeks = [];
  const cursor = new Date(firstSunday);
  while (true) {
    const sunday = new Date(cursor);
    const friday = new Date(cursor);
    friday.setDate(cursor.getDate() + 5);
    if (friday.getTime() > NOW_MS) break;
    completedWeeks.push({ sunday, friday });
    cursor.setDate(cursor.getDate() + 7);
  }
  if (completedWeeks.length === 0) return out;

  // Trend shape: rise-dip-recover across the WHOLE year. Position each
  // week along [0..1] so the same shape generates whether we're in
  // April (~17 weeks) or October (~40 weeks). Dip lives mid-cycle.
  const totalWeeks = completedWeeks.length;
  for (let i = 0; i < totalWeeks; i++) {
    const week = completedWeeks[i];
    const t = totalWeeks === 1 ? 1 : i / (totalWeeks - 1);
    const dip = Math.max(0, 1 - Math.abs(t - 0.5) * 4);
    const merged = Math.round(4 + 6 * t + dip * -2 + jitter(i, 1, 1.5));
    const reviews = Math.round(28 + 22 * t - dip * 6 + jitter(i, 2, 4));
    const turnaround = Math.max(
      4,
      Math.round(22 - 12 * t + dip * 6 + jitter(i, 3, 3)),
    );
    const linkage = Math.min(
      99,
      Math.max(70, Math.round(82 + 10 * t - dip * 6 + jitter(i, 4, 2))),
    );
    const rounds = Math.max(
      0.6,
      Math.round((2.6 - 0.8 * t + dip * 0.4 + jitter(i, 5, 0.3)) * 10) / 10,
    );
    const note = NOTES[i % NOTES.length];

    // Capture-time = end of work-week (Thursday EOD ≈ Friday 00:00).
    const capturedAt = week.friday.toISOString();
    const yearForLabel = week.sunday.getFullYear();
    const weekNo = isoWeekNumber(week.sunday);
    const weekTagBase = `${String(weekNo).padStart(2, "0")}-${yearForLabel}`;

    // Per-week goal readings — synthetic but rich enough that the
    // snapshot-compliance helper, the compare-weeks table, and the
    // evidence Expected/Achieved table all read as a coherent story.
    const goalReadings = goalReadingsForDemoWeek({
      i,
      totalWeeks,
      weekNo,
      year: yearForLabel,
      weekTagBase,
      week,
      merged,
      rounds,
      turnaround,
      linkage,
    });

    out.push({
      week: `W${String(weekNo).padStart(2, "0")}`,
      capturedAt,
      capturedBy: "auto",
      merged,
      reviews,
      turnaround,
      linkage,
      rounds,
      note,
      goalReadings,
      partial: false,
      gaps: [],
    });
  }

  // The snapshot store sorts newest-first, so flip the order. (Caller
  // would also handle this — but matching upstream conventions keeps
  // logs from anyone inspecting the store predictable.)
  return out.reverse();
}

/**
 * Synthetic goal-readings for a demo snapshot week. Mirrors what
 * `captureGoalReadings` would produce for the same goals against live
 * data — so the compliance helper, the compare-weeks table, and the
 * evidence Expected/Achieved table all read as a coherent story.
 *
 * Keep in lock-step with the demo goal IDs in `demo-goals.js`.
 * Each goal has a deterministic shape so the compliance percentages
 * land on round numbers when the year is mostly through:
 *
 *   mentor (weekly ≥3)              ≈ 95% compliance
 *   tight-rounds (weekly ≤2)        ≈ 80%
 *   linkage (weekly ≥90)            ≈ 85%
 *   turnaround (weekly ≤36h)        ≈ 92%
 *   ship-prs (quarterly ≥8)         100% closed quarters, in-progress on pace
 *   design-reviews (monthly ≥1)     ≈ 80% (Feb skipped)
 *   tech-book (monthly DATE_LOG)    1 per month, no formal target
 *   tickets (TICKET_CYCLE)          weekly count surfaced
 *   reflection (FREE_TEXT)          1 entry every ~3 weeks
 *   confidence (SCALE)              latest rating per week
 *   runbooks (MILESTONE quarterly)  cumulative items-done %
 *   succession (delegated)          milestone, no self-track
 *   oncall (BEFORE_AFTER)           24min → 8min static after week 5
 *   code-rubric (CODE_RUBRIC)       weekly merged-PR count for context
 */
function goalReadingsForDemoWeek({
  i,
  totalWeeks,
  weekNo,
  year,
  weekTagBase,
  week,
  merged,
  rounds,
  turnaround,
  linkage,
}) {
  const weeklyWin = `W${weekTagBase}`;
  const monthIdx = monthFromWeekNo(weekNo);
  const monthlyWin = `${year}-${String(monthIdx).padStart(2, "0")}`;
  const quarterIdx = Math.ceil(monthIdx / 3);
  const quarterlyWin = `${year}-Q${quarterIdx}`;

  // Deterministic per-goal patterns ─────────────────────────────────

  // Mentor (weekly ≥3): mostly 3, every ~13th week is 2 (partial).
  //   With ~17 weeks → 1 partial + 16 perfect → 97% with partial credit.
  const mentorWeekly = (weekNo % 13 === 0) ? 2 : 3;

  // Design reviews (monthly ≥1): 1 review per month, but Feb skipped.
  //   In Feb (month 2) the weekly contribution stays 0 the whole month;
  //   in other months we drop a "1" in the second week so the monthly
  //   cumulative hits target.
  const isLastWeekOfMonth =
    monthFromWeekNo(weekNo + 1) !== monthIdx;
  const designThisWeek = monthIdx === 2 ? 0 : isLastWeekOfMonth ? 1 : 0;

  // Confidence (weekly SCALE): values 3..5, rising arc with a dip mid-cycle.
  //   This is "current state" — windowMet=null so the compare cell shows
  //   the value with the neutral · symbol.
  const confidencePattern = [3, 4, 3, 4, 4, 5, 4, 3, 4, 4, 5, 4, 4, 5, 4, 5, 4, 5];
  const confidenceWeekly = confidencePattern[i % confidencePattern.length];

  // Tech books (monthly DATE_LOG): 1 entry in the last week of each month.
  const techBookWeekly = isLastWeekOfMonth ? 1 : 0;

  // Reflections (FREE_TEXT, continuous): 1 entry every 3 weeks.
  const reflectionWeekly = i % 3 === 0 ? 1 : 0;

  // Runbooks (MILESTONE quarterly target ≥1): cumulative items-done.
  //   Demo: 0, 0, 0, 1, 1, 2, 2, 2, 2, ... → 50% by mid-cycle.
  const runbooksDone = Math.min(2, Math.floor(i / 4));
  const runbooksPct = Math.round((runbooksDone / 4) * 100);

  // On-call before/after: baseline 24, current improves over time.
  //   Baseline captured early; current = max(8, 24 - i) so it ratchets
  //   down through the cycle.
  const oncallCurrent = Math.max(8, 24 - i);

  // Succession (delegated, milestone). 4 quarterly panels — Q1 done by
  //   the time we're past it, Q2 done after Q2 ends, etc.
  const successionItemsDone = Math.min(4, Math.max(0, Math.floor((monthIdx - 1) / 3)));
  const successionPct = Math.round((successionItemsDone / 4) * 100);

  // Ship 8 PRs/quarter — quarterly cumulative. We approximate the
  //   running total by multiplying weekly merged count by the index
  //   within the quarter (1..13). When the quarter ends with the week,
  //   windowMet "locks" if ≥8.
  const weekInQuarter = Math.min(13, ((weekNo - 1) % 13) + 1);
  const quarterCumulative = Math.round(merged * weekInQuarter * 0.6); // softened
  const quarterMet = quarterCumulative >= 8;

  return {
    // ── Auto widgets ──────────────────────────────────────────────
    "demo-l2-ship-prs": {
      cadence: "quarterly",
      cadenceWindow: quarterlyWin,
      weekContribution: merged,
      cumulative: quarterCumulative,
      target: { op: ">=", value: 8 },
      windowMet: quarterMet,
      onPace: true,
    },
    "demo-l2-turnaround": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: turnaround,
      cumulative: turnaround,
      target: { op: "<=", value: 36 },
      windowMet: turnaround <= 36,
      onPace: null,
    },
    "demo-l2-linkage": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: linkage,
      cumulative: linkage,
      target: { op: ">=", value: 90 },
      windowMet: linkage >= 90,
      onPace: null,
    },
    "demo-l2-tight-rounds": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: rounds,
      cumulative: rounds,
      target: { op: "<=", value: 2 },
      windowMet: rounds <= 2,
      onPace: null,
    },
    "demo-l2-tickets-done": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: 5 + (i % 3),
      cumulative: 5 + (i % 3),
      target: null,
      windowMet: null,
      onPace: null,
    },
    "demo-l2-code-quality": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: merged,
      cumulative: merged,
      target: null,
      windowMet: null,
      onPace: null,
    },

    // ── Manual widgets ────────────────────────────────────────────
    "demo-l2-mentor": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: mentorWeekly,
      cumulative: mentorWeekly,
      target: { op: ">=", value: 3 },
      windowMet: mentorWeekly >= 3,
      onPace: null,
    },
    "demo-l2-confidence": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: confidenceWeekly,
      cumulative: confidenceWeekly,
      target: null,
      windowMet: confidenceWeekly >= 4,
      onPace: null,
    },
    "demo-l2-tech-book": {
      cadence: "monthly",
      cadenceWindow: monthlyWin,
      weekContribution: techBookWeekly,
      cumulative: techBookWeekly,
      target: null,
      windowMet: null,
      onPace: null,
    },
    "demo-l2-reflection": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: reflectionWeekly,
      cumulative: reflectionWeekly,
      target: null,
      windowMet: null,
      onPace: null,
    },
    "demo-l2-runbooks": {
      cadence: "quarterly",
      cadenceWindow: quarterlyWin,
      weekContribution: null,
      cumulative: runbooksPct,
      target: null,
      windowMet: runbooksPct === 100 ? true : false,
      onPace: null,
    },
    "demo-l2-design-reviews": {
      cadence: "monthly",
      cadenceWindow: monthlyWin,
      weekContribution: designThisWeek,
      cumulative: designThisWeek,
      target: { op: ">=", value: 1 },
      windowMet: designThisWeek >= 1,
      onPace: null,
    },
    "demo-l2-oncall-response": {
      cadence: "weekly",
      cadenceWindow: weeklyWin,
      weekContribution: null,
      cumulative: oncallCurrent,
      target: null,
      windowMet: oncallCurrent < 24, // improving counts as met
      onPace: null,
    },
    "demo-l2-succession": {
      cadence: "quarterly",
      cadenceWindow: quarterlyWin,
      weekContribution: null,
      cumulative: successionPct,
      target: null,
      windowMet: null, // delegated — judged externally
      onPace: null,
    },
  };
}

/** Approx month from week number (assumes ~4.33 weeks per month). */
function monthFromWeekNo(weekNo) {
  return Math.min(12, Math.max(1, Math.ceil(weekNo / 4.33)));
}

const NOTES = [
  "Cleared idempotency-key followups; PSP backpressure in review.",
  "Quiet week — most cycles spent in design-system PRs.",
  "Migrated observability stack stuck in finance review.",
  "Shipped JWT rotation. Auth backlog finally moving.",
  "Q1 wrap; cohort-retention chart landed late but landed.",
  "Lots of review traffic, light merge volume.",
  "Backfill v3 review thrashed — 3 reviewers, real comments.",
  "Two on-call days; everything caught fire and got patched.",
  "Hotfix week. Five tiny PRs to keep prod calm.",
  "Onboarding wizard merged; UX feedback positive.",
  "Reconciliation v1 over the line.",
  "Light week, tickets in flight.",
  "Pre-quarter-close push.",
  "First snapshot of the year.",
];

function jitter(seed, salt, magnitude) {
  // Tiny seedable pseudo-random in [-mag, +mag]. Stable across reloads.
  const s = (seed * 9301 + salt * 49297) % 233280;
  return ((s / 233280) - 0.5) * 2 * magnitude;
}

function isoWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / DAY + 1) / 7);
}

export const DEMO_ME = {
  name: "Demo Engineer",
  team: "Payments Platform",
  username: ME,
  handle: ME,
  avatar_url: null,
};
