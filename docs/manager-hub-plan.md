# Manager Hub — plan

> Role-scoped hub for engineering managers: see your reports' goal progress,
> grade it on the achievement tiers, judge delegated goals, and approve the
> "Build Your Own" trackers your reports compose.
>
> Status: **planning**. Visual direction is mocked (warm-white + orange skin).
> A few product decisions are marked **PROPOSED — confirm** below; they change
> the data model, so lock them before building P2+.

## Why this is mostly a read-surface problem, not a role problem

The manager *identity* already exists end-to-end; the manager *experience*
does not. Confirmed against the code:

| Already exists | Where |
|---|---|
| `manager` role + multi-role capability model | `packages/shared/src/capabilities/roles.js`, `apps/api/src/lib/user-roles.ts` |
| `HUB_MANAGER_ACCESS` + `manager.team.view` capabilities (granted, unused) | `packages/shared/src/capabilities/capabilities.js` |
| `MANAGER_HUB` registry entry (pages `dashboard/employees/settings`, `team`/`employees` slots reserved) | `packages/shared/src/hubs/registry.js` |
| Manager→report edge `User.managerId` + index `users_org_manager` | `apps/api/src/db/types.ts`, `apps/api/src/db/collections.ts` |
| Capability-gated hub resolution `GET /hubs/me` | `apps/api/src/modules/hubs/controller.ts` |
| Header nav label override (`manager: { dashboard: "Team" }`) | `apps/web/src/components/shell/header.jsx` |

| Missing — the actual work | Note |
|---|---|
| `apps/web/src/hubs/manager/` UI | Only `admin/` + `qa/` hubs are built; `dashboard-registry.jsx:40` renders a placeholder |
| Any cross-user read of performance data | Every goals/specs/inputs/snapshots/verdict read is hard-scoped to `session.userId` |
| A manager-authored tier verdict | Tiers are AI-only today (`goal_tier_verdicts` cache) |
| A goal/spec approval state | BYO composed trackers commit instantly; no status field anywhere |
| A notifications system | None — only transient `sonner` toasts |
| A server-side capability guard | Only `requireRole(...)` (primary-role snapshot) exists |

## PROPOSED decisions — confirm before P2

1. **Grading model:** a manager verdict **overrides** the AI tier; the AI grade
   pre-fills as a suggestion the manager can accept or change. (Alt: coexist /
   manager-is-sole-grader.)
2. **BYO approval:** **hard gate** — a composed tracker enters `pending` and is
   not active until approved. (Alt: soft gate / gate all custom specs.)
3. **Team assignment (pre-Zoho):** **admin assigns** `managerId` via the
   existing admin user editor. (Alt: manager self-selects / both.)
4. **Notifications:** in-app bell + inbox for v1; no email.

## The four features → concrete build

### ① View a report's progress
- **API (new `apps/api/src/modules/manager/`):**
  - `GET /api/v1/manager/reports` → users where `managerId === session.userId`,
    with a rolled-up health summary per report.
  - `GET /api/v1/manager/reports/:userId/goal-health` → that report's goals +
    specs + context + inputs + tier verdicts, shaped for the health view.
  - Authorization: `manager.team.view` capability **and** `managerId` ownership
    (admins bypass). Pattern to copy: `apps/api/src/modules/admin/controller.ts`.
- **Web (`apps/web/src/hubs/manager/`):** `manager-dashboard.jsx` (team
  overview + roster), `employee-list`, `employee-detail` (goal board).
- **Refactor:** extract the pure health derivation (`deriveGoalHealth`,
  `status.js`) out of `features/intelligence` (a product surface a hub may not
  import) into a shared domain, then reuse it per-report. Parameterize the
  existing single-user hooks by `userId`.

### ② Track & judge delegated goals
- Delegation already exists as an **inert** flag: `spec.delegated.judge ===
  "manager"` renders a "your manager evaluates this" card
  (`goal-widgets/state-shells/delegated-card.jsx`) with no manager response path.
- **API:** `GET /api/v1/manager/delegated-queue` (delegated goals across all
  reports awaiting a verdict) + the verdict-write path from ④.
- **Web:** a "Delegated" queue in the manager hub; each item opens the same
  grading drawer as ④.

### ③ Approve Build-Your-Own composed goals
- Today `compose-widget-modal` → `saveSpec` commits a COMPOSED spec live with
  no gate.
- **Data:** add `spec.approval = { status: "pending" | "approved" | "rejected",
  reviewedBy, reviewedAt, note }` (new — no status field exists). Scope to
  `COMPOSED` specs per decision #2.
- **Flow:** committing a BYO spec sets `status: "pending"`; the goal renders a
  "pending approval" state shell (mirror `delegated-card`) and is excluded from
  grading until approved.
- **API:** `GET /api/v1/manager/approvals` (pending BYO specs across reports),
  `POST /api/v1/manager/approvals/:userId/:goalId` `{ decision, note }`.
- **Web:** an "Approvals" queue showing the composed fields + proposed tiers,
  with Approve / Request-changes. On approve → spec activates; report notified.

### ④ Grade on the achievement tiers + notify
- Tiers (`not_achieved · achieved · over_achieved · role_model`) are graded by
  an LLM into `goal_tier_verdicts` (a 180-day cache keyed `(orgId, userId,
  goalId)`).
- **Data:** a manager verdict that outranks the AI one. Either a new
  `manager_verdicts` collection or extend the verdict doc with
  `source: "ai" | "manager"`, `gradedBy`, `note`. Read path (`use-goal-tier.js`)
  prefers the manager verdict when present.
- **API:** `POST /api/v1/manager/reports/:userId/goals/:goalId/verdict`
  `{ tier, note }`.
- **Web:** a grading drawer (4-rung ladder, AI suggestion pre-filled, note box)
  in the employee detail + delegated queue. Dev's tier badge then reads "graded
  by your manager."

### Sub-features that fall out
- **Notifications backbone** (new): `notifications` collection, `GET
  /notifications`, `PATCH /notifications/:id/read`, header bell + inbox. Emitted
  on grade, approval decision, and BYO submission.
- **Team assignment:** extend the admin user editor to set `managerId`
  (`apps/web/src/hubs/admin/admin-users.jsx` + `PATCH /admin/users/:id`).
- **`requireCapability` middleware** (new, server-side) gating on
  `effectiveCapabilities` rather than the brittle primary-role snapshot.

## Theme — warm-white + orange

`HubProvider` currently applies **only `--primary`** per hub and deliberately
ignores each hub's `accent` (per the code comment, old per-hub accents "couldn't
dark-switch"). So the skin is a small design-system task, not a registry edit:

1. Add `data-hub={activeHub.id}` to the `HubProvider` wrapper
   (`apps/web/src/features/hubs/hub-provider.jsx`).
2. In `globals.css`, add a `[data-hub="manager"]` scope overriding the accent
   family (orange) for **both** themes + whiter surface tokens for light,
   mirroring the existing `[data-theme="dark"]` / `@media` structure so it
   dark-switches cleanly and only the manager hub re-skins.

Proposed values — light: accent `#e8590c`, ground `#fbf7f1`, cards `#ffffff`;
dark: accent `#ff7a29` over the base dark surfaces. Pace/health colors stay
**separate** from the accent (green on-pace, red behind); orange is reserved for
brand + "needs you."

## Phasing

- **P0 Foundation** — theme scope, `hubs/manager/` skeleton wired into
  `dashboard-registry.jsx` + `header.jsx` nav, `requireCapability`, empty
  `manager` API module.
- **P1 View** (①) — read endpoints + shared-health extraction + team/employee UI.
- **P2 Grade + Notify** (④ + notifications) — the backbone P3/P4 reuse.
- **P3 Delegated** (②) — reuses P2's verdict path.
- **P4 Approve BYO** (③) — most invasive (touches the compose commit flow); last.
- **P5 Assignment + polish** — admin `managerId` editor, settings, tests
  (keep the architecture-boundaries test green).

## Reference — visual mockup

An interactive warm-white/orange mockup of all four screens (team overview,
employee board + grading ladder, delegated queue, BYO approvals, notifications)
was produced for design sign-off. It stands in for the real Doto / Hanken
Grotesk / Space Mono fonts with system fallbacks.
