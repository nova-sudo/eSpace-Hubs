// Realistic dummy data for eSpace Dev Hub tiles

const ME = {
  name: "Mariam Hany",
  handle: "m.hany",
  avatar: "MH",
  role: "Senior Backend Engineer · eSpace",
  level: "L1 → L2 track",
  team: "Payments Platform",
};

const INTEGRATIONS = [
  { id: "jira",   label: "Jira",   user: "m.hany@espace.com.eg", connected: true,  since: "Aug 12, 2024" },
  { id: "gitlab", label: "GitLab", user: "@m.hany",              connected: true,  since: "Aug 12, 2024" },
  { id: "github", label: "GitHub", user: "@mariamhany",          connected: true,  since: "Mar 04, 2026" },
];

const TICKETS = [
  { key: "PAY-4812", title: "Refund webhook retries dropping 5xx after 3rd attempt", status: "In Progress", cat: "indeterminate", due: "Apr 24" },
  { key: "PAY-4801", title: "Idempotency key collision on Fawry callback",          status: "In Progress", cat: "indeterminate", due: "Apr 25" },
  { key: "PAY-4799", title: "Migrate settlement cron from Sidekiq to Oban",         status: "In Review",   cat: "indeterminate", due: "Apr 28" },
  { key: "PAY-4791", title: "Expose merchant KYB status via /v2/accounts",          status: "In Review",   cat: "indeterminate", due: "Apr 29" },
  { key: "PAY-4776", title: "3DS v2 challenge flow — Android WebView regression",   status: "To Do",       cat: "new",           due: "May 02" },
  { key: "PAY-4774", title: "Reduce p95 on /charges to <220ms",                     status: "To Do",       cat: "new",           due: "May 05" },
  { key: "PAY-4762", title: "Audit log PII scrubbing for GDPR export",              status: "Blocked",     cat: "new",           due: "—" },
  { key: "PAY-4750", title: "Dashboard: settlement timeline export to CSV",         status: "Done",        cat: "done",          due: "Apr 18" },
];

const OPEN_MRS_MINE = [
  { id: "gl-8821", num: "!8821", source: "GitLab", repo: "payments/core",      title: "fix(refunds): exponential backoff on webhook retries",  age: "2d", rounds: 1, draft: false, pipeline: "pass" },
  { id: "gl-8815", num: "!8815", source: "GitLab", repo: "payments/core",      title: "feat(idempotency): namespace keys by provider",          age: "4d", rounds: 3, draft: false, pipeline: "pass" },
  { id: "gh-312",  num: "#312",  source: "GitHub", repo: "espace/sdk-js",      title: "v3.2: typed error union for PaymentError",               age: "1d", rounds: 0, draft: true,  pipeline: "pending" },
  { id: "gl-8803", num: "!8803", source: "GitLab", repo: "payments/workers",   title: "chore: retire sidekiq-failures, move to Oban telemetry", age: "6d", rounds: 2, draft: false, pipeline: "fail" },
];

const OPEN_MRS_REVIEW = [
  { id: "gl-8829", num: "!8829", source: "GitLab", repo: "payments/core",    title: "refactor(charges): split ChargeService into cmd/query",  age: "5h",  author: "a.sabry" },
  { id: "gl-8824", num: "!8824", source: "GitLab", repo: "payments/core",    title: "feat(disputes): accept partial evidence uploads",        age: "1d",  author: "k.ashraf" },
  { id: "gh-144",  num: "#144",  source: "GitHub", repo: "espace/sdk-py",    title: "Async client — bring on par with sdk-js v3",             age: "2d",  author: "m.fathy" },
  { id: "gl-8810", num: "!8810", source: "GitLab", repo: "payments/workers", title: "fix: settlement worker lockup on DB failover",           age: "3d",  author: "n.adel" },
];

// 14d activity buckets (sparklines)
const ACTIVITY_14D = [
  { d: "Apr 09", n: 6  }, { d: "Apr 10", n: 11 }, { d: "Apr 11", n: 3 },  { d: "Apr 12", n: 0  },
  { d: "Apr 13", n: 8  }, { d: "Apr 14", n: 14 }, { d: "Apr 15", n: 19 }, { d: "Apr 16", n: 9  },
  { d: "Apr 17", n: 12 }, { d: "Apr 18", n: 22 }, { d: "Apr 19", n: 2 },  { d: "Apr 20", n: 1  },
  { d: "Apr 21", n: 17 }, { d: "Apr 22", n: 23 },
];

// Merged per week, 8 weeks
const MERGED_TREND = [
  { w: "W09", n: 3 }, { w: "W10", n: 5 }, { w: "W11", n: 4 }, { w: "W12", n: 6 },
  { w: "W13", n: 4 }, { w: "W14", n: 7 }, { w: "W15", n: 5 }, { w: "W16", n: 8 },
];

// Review turnaround distribution (hours)
const TURNAROUND_BUCKETS = [
  { b: "<2h", n: 3 }, { b: "2–8h", n: 9 }, { b: "8–24h", n: 11 }, { b: "1–2d", n: 6 }, { b: "2–4d", n: 2 }, { b: ">4d", n: 1 },
];

const METRICS = {
  mergedThisWeek:   8,
  mergedDelta:     +3,
  mergedTrend:     MERGED_TREND,
  avgRounds:       1.6,
  avgRoundsDelta: -0.4,
  turnaround:     "14h",
  turnaroundDelta:"-6h",
  turnaroundBuckets: TURNAROUND_BUCKETS,
  reviewsGiven:    47,
  reviewsDelta:   +12,
  linkage:         94,
  linkageDelta:   +2,
  cycleTime:      "2.3d",
  slaHit:          96,
  onCallIncidents: 2,
};

const SNAPSHOTS = [
  { week: "W16", date: "Apr 22, 2026", merged: 8, reviews: 47, linkage: 94, turnaround: 14, rounds: 1.6, note: "Idempotency patch shipped, p95 down 31%" },
  { week: "W15", date: "Apr 15, 2026", merged: 7, reviews: 42, linkage: 92, turnaround: 16, rounds: 1.8, note: "Peak review week — 3 MRs merged same-day" },
  { week: "W14", date: "Apr 08, 2026", merged: 5, reviews: 31, linkage: 90, turnaround: 18, rounds: 2.1, note: "Settlement cron migration started" },
  { week: "W13", date: "Apr 01, 2026", merged: 6, reviews: 28, linkage: 88, turnaround: 20, rounds: 2.0, note: "Quarter open — planning sprint" },
  { week: "W12", date: "Mar 25, 2026", merged: 4, reviews: 35, linkage: 85, turnaround: 22, rounds: 2.2, note: "On-call week — reduced throughput" },
  { week: "W11", date: "Mar 18, 2026", merged: 6, reviews: 24, linkage: 82, turnaround: 19, rounds: 2.0, note: "Disputes flow epic kickoff" },
  { week: "W10", date: "Mar 11, 2026", merged: 5, reviews: 30, linkage: 84, turnaround: 21, rounds: 2.3, note: "—" },
  { week: "W09", date: "Mar 04, 2026", merged: 3, reviews: 19, linkage: 78, turnaround: 26, rounds: 2.5, note: "GitHub side project launched (sdk-js)" },
];

// Attention items — stale PRs / old tickets surfaced proactively
const ATTENTION = [
  { id: "a1", kind: "stale-pr",   severity: "high", ref: "!8803", title: "chore: retire sidekiq-failures, move to Oban telemetry", detail: "6d open · pipeline failing · 2 unresolved threads", action: "Respond to comments" },
  { id: "a2", kind: "stale-pr",   severity: "med",  ref: "!8815", title: "feat(idempotency): namespace keys by provider",         detail: "4d open · 3 rounds · awaiting your reply",       action: "Reply to reviewer" },
  { id: "a3", kind: "old-ticket", severity: "med",  ref: "PAY-4762", title: "Audit log PII scrubbing for GDPR export",             detail: "Blocked 9d · no comment since Apr 13",            action: "Unblock or reassign" },
];

// Items starred as evidence for next review
const EVIDENCE_STARRED = [
  { id: "e1", kind: "merged-pr", ref: "!8815", title: "feat(idempotency): namespace keys by provider", date: "Apr 18", impact: "Closed duplicate-charge incident class (INC-0422 family)" },
  { id: "e2", kind: "ticket",    ref: "PAY-4750", title: "Settlement timeline CSV export", date: "Apr 18", impact: "Unblocked Finance team monthly reconciliation" },
  { id: "e3", kind: "merged-pr", ref: "!8789", title: "perf(charges): reduce p95 from 340ms → 218ms", date: "Apr 11", impact: "Met L2 latency KPI (<220ms) — first time since Q4" },
  { id: "e4", kind: "review",    ref: "!8829", title: "Split ChargeService into cmd/query — design feedback", date: "Apr 20", impact: "Prevented circular dep before merge; referenced by team later" },
];

// Candidates for starring (recent merges/closes) — shows in evidence picker
const EVIDENCE_CANDIDATES = [
  { id: "c1", kind: "merged-pr", ref: "!8821", title: "fix(refunds): exponential backoff on webhook retries", date: "Apr 22" },
  { id: "c2", kind: "merged-pr", ref: "!8798", title: "feat(sdk): typed error union for PaymentError",       date: "Apr 16" },
  { id: "c3", kind: "ticket",    ref: "PAY-4699", title: "Migrate auth middleware off deprecated JWT lib",    date: "Apr 09" },
  { id: "c4", kind: "review",    ref: "!8824", title: "Partial evidence uploads — reviewed",                 date: "Apr 21" },
  { id: "c5", kind: "merged-pr", ref: "!8772", title: "refactor(workers): extract RetryPolicy value object", date: "Apr 04" },
];

const RECENT_COMMITS = [
  { sha: "a8f3e21", msg: "refactor: pull Retry into RetryPolicy value object", repo: "payments/core", when: "2h" },
  { sha: "c19dd02", msg: "test: cover partial-failure retry exhaustion",       repo: "payments/core", when: "4h" },
  { sha: "71f9a44", msg: "docs(sdk): correct PaymentError discriminator",      repo: "espace/sdk-js", when: "1d" },
  { sha: "4d0b3c8", msg: "chore: bump elixir to 1.17.3",                        repo: "payments/workers", when: "2d" },
];

Object.assign(window, { ME, INTEGRATIONS, TICKETS, OPEN_MRS_MINE, OPEN_MRS_REVIEW, ACTIVITY_14D, MERGED_TREND, TURNAROUND_BUCKETS, METRICS, SNAPSHOTS, RECENT_COMMITS, ATTENTION, EVIDENCE_STARRED, EVIDENCE_CANDIDATES });
