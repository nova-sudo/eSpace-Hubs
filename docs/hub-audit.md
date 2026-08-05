# Hub audit — missing features & missing practices

> Cross-hub audit of `admin`, `dev`, `qa`, `manager`, with the Manager hub as
> the focus. Every finding below was verified against the code at the file/line
> cited — nothing here is speculative unless explicitly marked "judgement call".
>
> Scope: what's *missing*, not what's broken cosmetically. Ordered by severity
> inside each section.

---

## 0. TL;DR — the ten things I'd fix first

| # | Finding | Hub | Severity |
|---|---|---|---|
| 1 | Manager module writes **zero audit rows** — grades, approvals and tier policies leave no trail | manager | **critical** |
| 2 | Manager grades are **destructively upserted** — no grade history, no revision trail, no review-cycle key | manager | **critical** |
| 3 | `/[hub]/goals` and `/[hub]/evidence` have **no slot guard** — `/manager/evidence` and `/admin/goals` render Dev surfaces | all | **high** |
| 4 | A report with **no `managerId` auto-approves** their own BYO goals — the "hard gate" decision is bypassable | manager/dev | **high** |
| 5 | `managerId` can be set to a user who **holds no manager role** → approvals queue nobody can see | admin | **high** |
| 6 | No **manager-cycle / org-chart validation** beyond self-assignment (A→B→A is accepted) | admin | medium |
| 7 | `/hubs/me` fallback **admits every hub ignoring capabilities** when overrides disable everything | platform | medium |
| 8 | `ADMIN_USERS_MANAGE` / `ADMIN_HUBS_CONFIGURE` / `ADMIN_AUDIT_VIEW` are **enforced client-side only** — server uses `requireRole("admin")` | admin | medium |
| 9 | **Zero tests** for hubs, the registry, capabilities, `requireCapability`, or the hub-config merge | all | medium |
| 10 | `GET /admin/users` is **unpaginated** and loads the whole org | admin | medium |

---

## 1. Manager hub

The four planned features (view · delegate · approve · grade) are all shipped
and genuinely work. What's missing is everything *around* the grade — the
governance, the history, and the manager's own working life.

### 1.1 No audit trail on any manager action — **critical**

`apps/api/src/modules/manager/controller.ts` never imports `writeAudit`.
Verified: `grep -c writeAudit` returns **0** for the manager module, against
3 in `hub-configs`, 6 in `admin`, 4 in `evidence`, 3 in `companion`.

So these mutations are invisible to `/admin/audit`:

- `PUT /manager/reports/:userId/goals/:goalId/verdict` — a performance grade
- `POST /manager/reports/:userId/goals/:goalId/approval` — approve / reject
- `PUT|DELETE /manager/tier-policies/:code` — **org-wide** criteria changes
  affecting every developer sharing that Goal Code

The third is the worst: tier policies are explicitly org-scoped (`routes.ts:88`,
"not scoped to this manager's own reports"), so *any* manager can silently
rewrite the grading bar for the whole org with no record of who changed what.

**Fix:** `writeAudit` at all five call sites with actions
`manager.verdict.set`, `manager.approval.decide`, `manager.tier_policy.set`,
`manager.tier_policy.delete`, carrying `before`/`after`. This is a two-hour
change and it's the single highest-value gap in the hub.

### 1.2 Grades have no history and no review-cycle dimension — **critical**

`apps/api/src/lib/manager-verdicts.ts:26` — `upsertManagerVerdict` does a single
`updateOne(..., { upsert: true })` on `(orgId, subjectUserId, goalId)`. The
previous tier, note, grader and timestamp are **overwritten in place**.

Consequences:

- A manager can silently downgrade a grade a report already saw. There is no
  way for the report, a skip-level, or HR to know it changed.
- `ManagerGoalVerdict` (`db/types.ts:680`) has **no period/cycle field**. One
  goal can only ever hold one grade, forever. Grading the same goal for Q1 and
  then Q2 destroys Q1. For a system whose whole premise is cadence windows
  (`goal-inputs/cadence-windows`), that's a structural mismatch.
- No appeal / acknowledgement state — the report cannot record "I've seen this"
  or "I disagree", which is table stakes for a performance-review tool.

**Fix:** make the verdict collection append-only (`supersededAt`, or a
`manager_goal_verdict_events` log) and key it by `(orgId, subject, goalId,
periodKey)`. The read path already funnels through `getManagerVerdictMap`, so
"latest wins" stays a one-line change.

### 1.3 Approval gate is bypassable when no manager is assigned — **high**

`apps/api/src/modules/goal-specs/controller.ts:65-70`:

```js
const managerId = me?.managerId ?? null;
if (!managerId) {
  res.json({ status: "approved" });   // ← auto-approve
  return;
}
```

Decision #2 in `docs/manager-hub-plan.md` is a **hard gate**: a composed tracker
must not be active until approved. Today, any engineer without a `managerId`
(the default — `auth/controller.ts:557` and `:1296` both create users with
`managerId: null`) composes BYO goals that go live instantly. Since manager
assignment is a manual admin action with no enforcement anywhere, this is the
*normal* path, not an edge case.

**Fix:** decide the policy explicitly. Either fall back to an org-level default
approver / any admin, or hold the spec `pending` with a clear "no approver
assigned — ask your admin" state shell. Silently approving is the one option
that contradicts the written decision.

### 1.4 No graceful degradation when a manager is unavailable — **high**

There is no delegate, no out-of-office, no escalation, and no reassignment:

- `resolveReport` (`controller.ts:157`) checks only `managerId.equals(session.userId)`.
  There is no skip-level path — a director cannot see their reports' reports,
  and cannot cover for a manager on leave.
- When a manager is disabled, `listReportsHandler` filters *reports* by
  `status: { $ne: "disabled" }` (`:110`) but nothing reassigns the orphaned
  reports. Their pending approvals sit in a queue with no reader forever.
- No bulk "reassign all reports from A to B" in the admin user editor.

**Fix (minimum viable):** admin bulk-reassign + surface "N reports have a
disabled manager" on the admin dashboard. **Fuller:** a `manager.team.view`
grant that follows the org chart transitively for skip-levels.

### 1.5 Missing manager surfaces (feature gaps, not bugs)

Registry (`packages/shared/src/hubs/registry.js:197`) exposes
`dashboard · employees · delegated · approvals · tierpolicies · settings`.
What a manager plausibly needs that doesn't exist anywhere:

| Missing | Why it matters | Where it'd live |
|---|---|---|
| **Team trend over time** | Every number on the dashboard is a *right now* number. `snapshots` exists per-user and is dev-only; a manager can't see whether the team got better. | new `manager:trends` slot over the snapshots collection |
| **Export / review packet** | `features/evidence` renders a beautiful markdown/PDF packet — for yourself only. A manager preparing a review cycle has no export at all. | reuse `evidence/markdown-export.js` with a `userId` param |
| **Grading progress / cycle completion** | No "you've graded 4 of 11 goals this cycle", no deadline, no reminder. The whole grading exercise has no notion of being *done*. | dashboard stat + a cycle model |
| **1:1 / check-in notes** | Grades carry a `note`, but there's no running per-report journal. Managers will use Notion instead, and the evidence trail leaves the product. | new `manager:notes` |
| **Comparison across reports** | The board is strictly one report at a time. No side-by-side tier distribution, no calibration view — which is exactly what managers do at review time. | dashboard section |
| **Manager's own goals** | A manager only sees their own goals if they *also* hold the `dev` role and switch hubs. Managers have goals too. | expose `goals` in the manager hub, or a "my goals" card |
| **Roster search on the dashboard** | `manager-employees.jsx` has search/filter/group-by; `manager-dashboard.jsx` roster has none. Fine at 8 reports, not at 25. | lift the filter bar |
| **Notification preferences** | Bell only. No email, no digest, no mute (`docs/manager-hub-plan.md` explicitly deferred email — still deferred). | settings tab |

### 1.6 Manager hub Settings is nearly empty — medium

`allowedIntegrations: []` (registry `:196`) plus no `goals`/`snapshots` slots
means `settings-page.jsx`'s filters strip the Onboarding, Integrations and
Snapshots tabs. A manager sees **Account + Danger zone** only. There's no
manager-relevant preference surface at all (grading defaults, notification
routing, default cycle). Judgement call, but a Settings page with two tabs and
one of them being "Danger zone" reads as unfinished.

### 1.7 Stale scaffolding — low

- `manager-placeholder.jsx` is still exported from `hubs/manager/index.js:12`
  and still says "Landing in the next drop" for the `employees` slot — which
  shipped. It is now unreachable dead code; the plan doc says all phases are
  complete.
- `manager-employee-board.jsx:9` header comment still says grading and BYO
  approvals "land in P2–P4". They landed.
- `registry.js:28` describes the manager hub as "(placeholder UI)" and
  `:83` calls Manager's accent "blue" while the theme is orange.

---

## 2. Admin hub

The best-built hub — audit log, signup codes, TOTP reset, personal-data reset,
hub overrides. Gaps are mostly about enforcement and scale.

### 2.1 Granular admin capabilities are client-side-only — **medium**

`CAPABILITIES.ADMIN_USERS_MANAGE` / `ADMIN_HUBS_CONFIGURE` / `ADMIN_AUDIT_VIEW`
are defined (`capabilities.js:37-39`) and granted to `admin` (`roles.js:50-52`),
but the only enforcement is in the browser:

- `admin-users.jsx:60`, `admin-hub-config.jsx:51` — `RequireCapability` wrappers
- Server side, **every** admin route uses `requireRole("admin")`
  (`admin/routes.ts`, `hub-configs/routes.ts`)
- `ADMIN_AUDIT_VIEW` is used **nowhere at all** — not client, not server

So the capabilities are decorative: you can't actually grant someone
"user management but not hub config", and a client-side check is not a control.
The manager module already does this correctly with `requireCapability`.

**Fix:** swap `requireRole("admin")` → `requireCapability(...)` per route, and
gate the audit page on `ADMIN_AUDIT_VIEW`.

### 2.2 `requireRole` reads a stale session snapshot — medium

`middleware/require-role.ts` reads `req.session.roles` (mint-time snapshot,
resynced only via `syncSessionRolesForUser`), while `require-capability.ts`
re-reads the user doc every request. Two different freshness models guarding
adjacent routes is a bug waiting to happen — a role *revocation* stays effective
on admin routes until logout. Pick one (capability, fresh) and retire the other.

### 2.3 `GET /admin/users` is unpaginated — medium

`admin/controller.ts:357-363` does `.find({ orgId }).toArray()` with no limit.
The code comment even says pagination is "if the UI ever adds it". The audit
feed *does* paginate (`:742-748`, cursor + `hasMore`), so the pattern exists;
users just doesn't use it. `admin-users.jsx` is 1194 lines and filters entirely
client-side.

### 2.4 Missing admin surfaces

| Missing | Note |
|---|---|
| **Org-chart view** | `managerId` is editable per-user in a 1194-line form, but there is no view of the resulting tree — no way to spot orphans, cycles, or a manager with 40 reports. |
| **Cycle/org-cycle validation** | Only self-assignment is blocked (`controller.ts:396-414`). A→B→A is accepted, and nothing checks the assigned manager holds the `manager` role or is `active`. See §3.1. |
| **Bulk operations** | No bulk role grant, bulk manager assign, bulk disable, CSV import/export. Every user is edited one at a time. |
| **Audit export** | The feed is filterable and paginated but read-only in the browser. Compliance asks for a CSV. |
| **Audit retention / integrity** | `lib/audit.ts` is append-only *by convention* ("there is no `updateAudit`"), with no TTL, no immutability at the DB layer, no tamper evidence. |
| **Org settings** | Signup codes live under Users. No org-level surface (name, domain allowlist, default hub, session TTL, password policy). |
| **Hub override coverage** | `mergeHubOverride` supports `enabled · label · description · allowedIntegrations · pages · departments`. It cannot override `widgets`, `theme`, or `requires` — so per-org branding and per-org widget catalogs aren't reachable, despite `widgets` being in the registry. |

### 2.5 The `widgets` catalog is dead data — low

Every hub declares a `widgets` array (`registry.js:96, 128, 165, 205`). The only
consumer in the entire codebase is `qa-placeholder.jsx:32`, which prints them as
text on a "coming soon" screen. Either wire it into a real widget resolver or
delete it — right now it's a contract nobody honours.

---

## 3. Cross-hub / platform

### 3.1 Two page routes have no slot guard — **high**

Verified across all 17 route files under `apps/web/src/app/[hub]/`:

| Route | `useHubSlotGuard` |
|---|---|
| `goals/page.jsx` | ❌ **none** |
| `evidence/page.jsx` | ❌ **none** |
| `checkin/page.jsx`, `checkin/grid/page.jsx` | ❌ none (retired routes) |
| `settings/page.jsx` | ❌ none (intentional — every hub has settings) |
| everything else (`users`, `audit`, `employees`, `delegated`, `approvals`, `tier-policies`, `hub-config`, `snapshots`, `reviews`, `goals-v2`) | ✅ guarded |

The manager hub's `pages` map has no `goals` and no `evidence` key; the admin
hub has neither either. So `/manager/evidence`, `/manager/goals`,
`/admin/evidence` and `/admin/goals` all render the **Dev** feature pages under
the wrong hub's theming — exactly the failure `use-hub-slot-guard.js:8` was
written to prevent ("a QA user typing /qa/reviews would see the Dev review-log
page rendered under QA theming — confusing").

**Fix:** two one-line additions. This is the cheapest high-severity item here.

### 3.2 `/hubs/me` fallback ignores the capability gate — medium

`apps/api/src/modules/hubs/controller.ts:99-114`. When every hub is
admin-disabled for an org, the handler's last-resort branch pushes **every hub
in `HUB_ORDER`** into the response, bypassing `resolveHubsForCapabilities`
entirely. The comment calls it "worst-case correctness", but the worst case it
produces is a dev seeing the Admin hub in their switcher. Server routes still
403, so it isn't a data breach — it is a broken authorization surface, and
"navigable" isn't worth it.

**Fix:** fall back to the *capability-allowed* set ignoring overrides, not to
every hub.

### 3.3 No tests anywhere near the hub system — medium

All 11 test files in the repo:

```
apps/api/.../ai/compose-guards · ai/extract · integrations/query-routes · integrations/query-runner
apps/web/.../architecture-boundaries · goal-inputs/cadence-windows
       .../goal-tiers/field-resolution · goals-flow/flow-geometry · integrations/metrics/regression
packages/shared/.../goal-specs/periods · goal-specs/query-templates
```

Nothing covers: the hub registry, `resolveHubsForCapabilities`,
`mergeHubOverride`, `requireCapability`, `requireRole`, the manager
authorization boundary (`resolveReport`), or any hub UI. The manager boundary in
particular — "a manager can only ever see their own reports" — is the single
most security-relevant invariant in the app and has no test asserting it.

**Fix (highest value first):** `resolveReport` boundary tests (404 for a
stranger's id, for a cross-org id, for a malformed id), then `mergeHubOverride`,
then `resolveHubsForCapabilities`.

### 3.4 Notifications are a stub of the planned system — medium

Shipped: 5 kinds (`db/types.ts:636`), a bell, mark-read, mark-all-read, 180-day
TTL. Missing:

- **No pagination** — `notifications/controller.ts:55` hard-caps at
  `.limit(50)` with no cursor. Notification 51 is unreachable.
- **No inbox page** — the plan said "header bell **+ inbox**"; only the bell
  exists (`features/notifications/` is 4 files, 304 lines).
- **No email**, no digest, no preferences, no mute (explicitly deferred, still
  deferred).
- **Coverage gaps** — nothing notifies on tier-policy changes (which change the
  bar a dev is graded against), on manager reassignment, or on a manager's
  pending queue going stale.

### 3.5 Reserved-but-dead surfaces — low

- `HUB_HR_ACCESS` / `HUB_PO_ACCESS` capabilities exist; the role grants are
  commented out (`roles.js:65, 70`) and no hub, folder or department mapping
  exists. Fine as a reservation — worth a tracking issue so it doesn't rot.
- `PAGE_SLOTS` (`registry.js:55`) lists `analyst`, `reviews`, `snapshots` — all
  dev-only in practice.
- The `dashboard` feature slice is documented as retired and "slated for
  removal" in `CLAUDE.md`, but `app/[hub]/goals/page.jsx` still imports
  `GoalsTabPage` **from it** — so the retirement can't proceed as written.

---

## 4. QA hub

Genuinely mid-build, and honest about it (`qa-dashboard.jsx:15-20` lists PR B/C/D).
Flagging the structural gaps rather than the unbuilt widgets:

- **Registry promises exceed reality.** `widgets` declares `defect-leakage`,
  `test-cycle-time`, `regression-rate`, `build-pass-rate`; four tiles exist and
  only one name matches (`build-pass-rate`). The others are
  `flake-rate`, `defects`, `defect-priority-mix`.
- **Jenkins is wired but QA-only.** The client exists
  (`api-clients/jenkins.js`) and QA is the only hub listing it in
  `allowedIntegrations`. Fine — just note that the QA config surface
  (`settings/tabs/qa-config-tab.jsx` + `use-qa-hub-config.js`) is a QA-specific
  settings mechanism with no analogue in any other hub, so per-hub config is a
  one-off rather than a pattern.
- **No QA lead role.** QA has the same manager problem Dev had: a QA lead
  reviewing QA engineers has to be granted `manager` and lives in the Manager
  hub, whose grading surface is Dev-goal-shaped. Either that's the intended
  design (say so in the registry comment) or QA needs its own review path.
- **QA gets `goals` + `evidence`** (registry `:159`) — both of which render the
  Dev feature slices verbatim. Whether Dev goal specs / evidence packets are
  meaningful for QA is an open product question nobody has answered in code.
- **No QA snapshots/trends** — same "no history" gap as Manager.

---

## 5. Dev hub

Most complete by far. Two notes:

- **Retirement is stalled.** `CLAUDE.md` marks `features/dashboard` retired and
  slated for removal, but `/[hub]/goals` still imports from it. The removal
  needs `GoalsTabPage` extracted first.
- **The Dev hub can't see its own governance.** A dev graded by their manager
  gets a notification and a "graded by your manager" badge, but there's no view
  of *why the bar is what it is* — manager tier policies (`/tier-policies/mine`
  is read-only and exists) aren't surfaced as a first-class "here's how you'll
  be graded" page. That's the highest-value Dev-side addition falling out of the
  Manager work.

---

## 6. Suggested sequencing

**Week 1 — cheap and high value**
1. Slot guards on `goals` + `evidence` (§3.1) — two lines
2. `writeAudit` across the 5 manager mutations (§1.1)
3. `resolveReport` boundary tests (§3.3)
4. Fix the `/hubs/me` fallback (§3.2)

**Week 2 — correctness of the review record**
5. Append-only verdicts + `periodKey` (§1.2)
6. Resolve the no-manager auto-approve policy (§1.3)
7. Validate `managerId` targets: active + holds `manager` role + no cycle (§1.4, §2.4)

**Week 3+ — product**
8. Manager review-cycle model → grading progress, deadlines, export packet (§1.5)
9. Server-side granular admin capabilities (§2.1)
10. Notifications: pagination, inbox page, preferences (§3.4)
