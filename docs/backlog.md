# eSpace Dev Hub — engineering backlog

> Canonical, prioritized ticket list. Correlated from the
> [complexity & risk audit](../maps/complexity-map.html) (12 source-anchored
> risks) plus remaining roadmap work in
> [`docs/widget-system-rethink.md`](widget-system-rethink.md) and
> [`docs/product-strategy-goal-intelligence-hub.md`](product-strategy-goal-intelligence-hub.md).
> A visual board of this same list lives at
> [`maps/backlog.html`](../maps/backlog.html).
>
> _Generated 2026-06-16. Source anchors are `file:line` or `doc § section` at
> time of writing — verify the line still points at the same code before acting._

## Legend

- **Priority** — `P0` critical (do now) · `P1` high · `P2` medium · `P3` later
- **Type** — `reliability` · `cost` · `security` · `data-integrity` · `tech-debt` · `feature` · `docs`
- **Size** — `S` (≲1 day) · `M` (a few days) · `L` (a week+ / needs design)

---

## P0 — Critical

### BL-001 · Add a degraded-mode fallback for the companion request path
- **Priority:** P0 · **Type:** reliability · **Size:** L
- **Why:** The production data path is 5 single points of failure in series
  (Vercel → Mongo route → Cloudflare tunnel → single `api` container → corporate
  VPN → `git.bcn.crealogix.net`), 3 of which are owned by others, and the
  catch-all *deliberately refuses* to fall back. Any one link down blanks every
  integration tile.
- **Source:** [`[...path].ts:162-184`](../apps/web/src/pages/api/v1/%5B...path%5D.ts) (the "we DON'T fall back" branch), [`RUN_LOCALLY.md:102`](RUN_LOCALLY.md) (host stops → tunnel + api both drop)
- **Acceptance criteria:**
  - On `companion_unreachable`, the UI renders an explicit "backend offline" state instead of empty/broken tiles.
  - Tiles show last-good cached data (with an "as of <timestamp>" marker) when the live path fails.
  - A user can still sign in and reach settings when the companion is down (the auth bypass already exists — confirm it covers the recovery flow).

### BL-002 · Companion/tunnel health check + alerting
- **Priority:** P0 · **Type:** reliability · **Size:** M
- **Why:** A dropped tunnel (Cloudflare 1033/530) is currently discovered only
  via blank tiles. A liveness probe + alert turns a silent outage into a
  detected one.
- **Source:** [`[...path].ts:265-273`](../apps/web/src/pages/api/v1/%5B...path%5D.ts) (dead-tunnel-masks-core-endpoints rationale)
- **Acceptance criteria:**
  - A health endpoint/probe distinguishes "companion reachable" from "tunnel up but api down."
  - A dropped tunnel raises an alert (log/notification) within minutes, not on next user visit.
  - The companion-pairing UI surfaces current tunnel status.

---

## P1 — High

### BL-003 · Instrument AI cost and cap per-user grade-all
- **Priority:** P1 · **Type:** cost · **Size:** M
- **Why:** `CODE_RUBRIC` grade-all fires one Claude call per PR across a
  year-to-date window that can hold ≤1000 PRs, with no shared limiter and a
  per-device cache that re-spends tokens. There is no cost model and no ceiling.
- **Source:** [`use-graded-prs.js:262-368`](../apps/web/src/features/grading/use-graded-prs.js) (per-PR grade loop), [`github.js:67`](../apps/web/src/features/integrations/api-clients/github.js) (1000-result window)
- **Acceptance criteria:**
  - Calls/day and tokens/call are recorded and queryable.
  - A per-user grade-all ceiling blocks (or batches) runs above a configured PR count.
  - The user sees an estimated cost / PR count before confirming a grade-all.

### BL-004 · `INTEGRATION_TOKEN_KEY` backup & rotation runbook
- **Priority:** P1 · **Type:** security · **Size:** S
- **Why:** Provider tokens are encrypted at rest in Mongo and decryptable only
  with this key. Losing or rotating it on the companion host irreversibly bricks
  every encrypted token for every user.
- **Source:** [`proxy.ts`](../apps/api/src/modules/integrations/proxy.ts) (encrypt-at-rest / decrypt-server-side), [`docker-compose.yml:65`](../docker-compose.yml) (required env key)
- **Acceptance criteria:**
  - A documented procedure exists for backing up and restoring the key.
  - A rotation procedure re-encrypts existing tokens (or forces re-auth) without data loss.
  - The runbook names the blast radius and recovery steps if the key is lost.

### BL-005 · Cross-user localStorage leak regression test
- **Priority:** P1 · **Type:** security · **Size:** S
- **Why:** Per-user isolation on shared browsers rides on a manual allowlist
  wiped on auth transition. Any new `espace-devhub:` key added without updating
  the allowlist leaks one user's data to the next.
- **Source:** [`clear-user-storage.js:47-62`](../apps/web/src) (allowlist-driven wipe)
- **Acceptance criteria:**
  - A test enumerates every `espace-devhub:*` key the app writes and asserts each is in the wipe allowlist.
  - The test fails CI when a new prefixed key is introduced without allowlisting.

### BL-006 · Provision Redis for cross-process rate limiting
- **Priority:** P1 · **Type:** reliability · **Size:** M
- **Why:** There is currently zero shared rate limiter. The Redis service is
  already reserved in compose but unused; a second API instance would multiply
  upstream call rates with no coordination (and GitHub's 30/min limit looming).
- **Source:** [`docker-compose.yml:172-189`](../docker-compose.yml) (reserved `redis` under `future` profile)
- **Acceptance criteria:**
  - A shared limiter backed by Redis gates upstream/AI calls across processes.
  - Limits hold correctly with ≥2 API instances running.
  - Falls back gracefully (single-process limiter) when Redis is absent in dev.

### BL-007 · Harden dev Mongo and companion-host secret handling
- **Priority:** P1 · **Type:** security · **Size:** M
- **Why:** Dev Mongo runs with no auth, and companion-host secrets live in
  plaintext `.env.local`. On a shared/persistent host this is an exposure.
- **Source:** [`docker-compose.yml:32-35`](../docker-compose.yml) (no-auth dev Mongo), [`RUN_LOCALLY.md`](RUN_LOCALLY.md) (`.env.local` secret set)
- **Acceptance criteria:**
  - Mongo requires auth in any non-laptop (persistent/production) deployment shape.
  - `.env.local` secret handling on the companion host is documented and least-privilege.
  - No secret is logged or echoed by the boot path.

---

## P2 — Medium

### BL-008 · Fix CLAUDE.md "Rule 4" privacy doc-drift
- **Priority:** P2 · **Type:** docs · **Size:** S
- **Why:** Rule 4 claims tokens "never leave the browser," but tokens now live
  encrypted-at-rest in Mongo and are decrypted server-side. The advertised
  privacy posture is stale.
- **Source:** [`CLAUDE.md`](../CLAUDE.md) Rule 4 vs [`proxy.ts`](../apps/api/src/modules/integrations/proxy.ts) (server-side decrypt)
- **Acceptance criteria:**
  - Rule 4 (and the settings-page privacy copy it mirrors) accurately describes encrypted-at-rest + server-side decryption.
  - The doc states where the encryption key lives and links [BL-004](#bl-004--integration_token_key-backup--rotation-runbook).

### BL-009 · Surface "graded on truncated evidence" and chunk long grader inputs
- **Priority:** P2 · **Type:** data-integrity · **Size:** M
- **Why:** Comments are truncated at 12k chars and PR body at 4k before grading,
  and absence-of-evidence currently *passes* a criterion — so a long or noisy PR
  can be silently graded on a clipped, lenient view.
- **Source:** [`controller.ts:41-79`](../apps/api/src/modules/ai/controller.ts) (`COMMENT_CHAR_LIMIT`/`PR_BODY_CHAR_LIMIT` + pass-on-silence decision rules)
- **Acceptance criteria:**
  - A verdict graded on truncated input carries a visible "graded on truncated evidence" flag.
  - Long inputs are chunked (or summarized) so the grader sees the full PR rather than a hard clip.
  - "No evidence either way" is distinguishable from an affirmative pass.

### BL-010 · Surface silent upstream truncation
- **Priority:** P2 · **Type:** data-integrity · **Size:** M
- **Why:** GitHub's 1000-result / 300-event caps and GitLab's 1000-MR cap
  silently drop data for heavy authors, so metrics quietly understate activity
  with no signal to the user.
- **Source:** [`github.js:67,147-201`](../apps/web/src/features/integrations/api-clients/github.js), [`gitlab.js:19-30`](../apps/web/src/features/integrations/api-clients/gitlab.js)
- **Acceptance criteria:**
  - When a provider response hits its cap, the client detects it and sets a "results truncated" signal.
  - Affected tiles render a "showing first N — truncated" marker.
  - The signal is testable from a mocked capped response.

### BL-011 · Server-persist snapshots, tier verdicts, and goal locks
- **Priority:** P2 · **Type:** data-integrity · **Size:** L
- **Why:** Snapshots, tier verdicts, and goal locks are localStorage-only —
  device-local and wiped on every auth transition. A user loses history on
  device change or re-login.
- **Source:** [`goal-tier-store.js:1-17`](../apps/web/src), `snapshots-store.js`, `goal-locks` store
- **Acceptance criteria:**
  - Snapshots, tier verdicts, and locks persist server-side keyed by user.
  - Data survives logout/login and is available across devices.
  - A migration path imports existing localStorage data on first sync.

### BL-012 · Replace `user_notes_count` review-rounds proxy with real per-MR rounds
- **Priority:** P2 · **Type:** tech-debt · **Size:** M
- **Why:** Review-rounds is approximated by `user_notes_count`, which conflates
  comment volume with iteration count. Real rounds need per-MR `/discussions`.
- **Source:** [`CLAUDE.md`](../CLAUDE.md) "Open questions #2", [`metrics/rounds.js`](../apps/web/src/features/integrations/metrics/rounds.js)
- **Acceptance criteria:**
  - Rounds derive from per-MR `/discussions` (resolved threads / review iterations), not a raw note count.
  - The N+1 call cost is bounded (cached/batched) so it doesn't regress load time.
  - The rounds tile value matches a hand-counted sample MR.

### BL-013 · First-class PDF evidence export
- **Priority:** P2 · **Type:** feature · **Size:** M
- **Why:** PDF export is `window.print()` today — fragile, browser-dependent,
  off-brand. A real renderer (e.g. `@react-pdf/renderer`) gives a controlled,
  reproducible document.
- **Source:** [`CLAUDE.md`](../CLAUDE.md) "What's real vs. stubbed" (Evidence export `.pdf` ⚠️)
- **Acceptance criteria:**
  - PDF export produces a styled document without invoking the browser print dialog.
  - Output matches the `.md` export content and the Nothing UI aesthetic.
  - Export works headlessly (no manual print-to-PDF step).

---

## P3 — Later

### BL-014 · W3 — widget catalog expansion
- **Priority:** P3 · **Type:** feature · **Size:** L
- **Why:** The remaining widget-system-rethink work: ship the cheap AUTO widgets
  first (REVIEWS_GIVEN, TIME_TO_FIRST_REVIEW, PR_SIZE, ACTIVE_DAYS) reusing
  existing integration data, then fill catalog gaps.
- **Source:** [`docs/widget-system-rethink.md`](widget-system-rethink.md) § "Sprint W3 — Catalog expansion" (line 165) and § "Issue 3 — More widget types"
- **Acceptance criteria:**
  - The four cheap AUTO widgets ship reusing existing integration data + data-source plumbing.
  - New widgets carry unit-typed structured tiers (per the closed-loop fix) so the grader never says "data doesn't help."
  - Catalog additions are documented in the widget doc.

### BL-015 · Remove the retired legacy `dashboard` feature
- **Priority:** P3 · **Type:** tech-debt · **Size:** S
- **Why:** The perf bento `dashboard` feature is retired from nav and slated for
  removal per CLAUDE.md; it's dead weight and an architecture-boundary trap.
- **Source:** [`CLAUDE.md`](../CLAUDE.md) feature table ("legacy perf bento — slated for removal")
- **Acceptance criteria:**
  - `src/features/dashboard/` and its route wiring are removed.
  - No remaining imports reference the deleted feature; architecture-boundaries test passes.
  - Any still-needed tile/component is relocated to a live feature before deletion.

### BL-016 · Refactor classify/grade endpoints to client-driven fan-out
- **Priority:** P3 · **Type:** tech-debt · **Size:** M
- **Why:** `classify-goals` and `grade-pr` stream through Vercel's 10s/60s
  function cap; long sessions get cut off mid-stream. A fan-out of one short
  request per goal stays under the cap.
- **Source:** [`[...path].ts:48-58`](../apps/web/src/pages/api/v1/%5B...path%5D.ts) (streaming cap caveat), [`[...path].ts:242-258`](../apps/web/src/pages/api/v1/%5B...path%5D.ts) (`maxDuration: 60`)
- **Acceptance criteria:**
  - Classification/grading runs as multiple short requests (one per goal/unit) instead of one long stream.
  - No request approaches the 10s Hobby / 60s Pro execution cap under normal load.
  - Progress is reported incrementally to the UI as each unit completes.
