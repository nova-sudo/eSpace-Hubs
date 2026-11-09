# Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every in-app notification also emails its recipient, and every API email (notifications, digest, invite, reset) renders through one branded "tinted header" layout.

**Architecture:** A pure `renderEmail()` layout in `apps/api/src/lib/email-layout.ts`; a per-kind config table + pure send decision in `lib/notification-email.ts`; `createNotification` becomes the single choke point that writes the inbox row then emails it. Email CTAs go to a new web route `/n/[id]` that resolves the row through the existing `notificationPath()`.

**Tech Stack:** Node/Express + TypeScript API, nodemailer (already wired, `d715db4`), `node:test` via `tsx --test`; Next.js 16 JSX web.

**Spec:** `docs/superpowers/specs/2026-11-09-email-notifications-design.md`

## Global Constraints

- Product name in every email: **eSpace Hubs** (wordmark "eSpace" weight 800 + "Hubs" weight 600 `#71717a`). Never "eSpace Dev Hub".
- Logo: `${appOrigin()}/brand/png/mark-128.png`, rendered 28×28, `border-radius:9px`, above the card on the canvas (placement A). PNG only — no SVG in email.
- Palette (literal hex is allowed only inside `EMAIL_PALETTE`): canvas `#f4f4f5`, card `#ffffff`, fg `#18181b`, muted `#6d6d76`, line `rgba(24,24,27,0.07)`, ink `#18181b`, ink-on `#ffffff`; tints mint `#dcf5e6`/`#14532d`, peach `#ffe4d6`/`#9a3412`, lemon `#fbf3c4`/`#713f12`, sky `#e0eafe`/`#1e3a8a`.
- Layout: max width 560px, card radius 20px, header padding 18–20px, CTA = ink pill (`border-radius:999px`). Light only: `<meta name="color-scheme" content="light">`.
- Font stack: `Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`; Manrope `<link>` from Google Fonts.
- Sentence case in all copy. All caller strings are plain text; the layout escapes them.
- Email is best-effort: never throws, never fails the triggering request or inbox write.
- New test files must be appended to the explicit file list in `apps/api/package.json` `"test"` / `apps/web/package.json` `"test:regression"` or they will not run.
- Commit identity: repo-local `abdelrahmanNoaman23 <novaxaboud@gmail.com>` (existing); commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Recipient with no email / inactive / pending user** — no send, no throw. Pinned in Task 3 (`decideNotificationEmail` → `skip: "no-recipient"`).
2. **Unmutable kind listed in an old `muted` prefs row** — still emails (matches inbox). Pinned in Task 3.
3. **Hostile strings in titles** (a goal titled `<img onerror>` or containing `"`) — escaped in html, raw in text. Pinned in Task 1.
4. **`/n/<id>` for someone else's row or a deleted row** — API 404, web falls back to `/notifications`, never leaks. Pinned in Tasks 5 and 6.
5. **Multi-hub user clicking an email** (e.g. admin + dev opening `user_pending_approval`) — resolver must pick the hub that owns the path (`/users` → admin, `/approvals` → manager/admin) before falling back to the stored pick. Pinned in Task 6 (`resolveEmailTarget`).

---

### Task 1: Email layout

**Files:**
- Create: `apps/api/src/lib/app-url.ts`
- Create: `apps/api/src/lib/email-layout.ts`
- Test: `apps/api/src/lib/email-layout.test.ts`
- Modify: `apps/api/src/modules/auth/controller.ts:518-524` (replace local `appOrigin` with import), `apps/api/src/modules/github-links/publish.ts:~167` (same, keep its localhost-omission logic on top)
- Modify: `apps/api/package.json` test list

**Interfaces:**
- Produces:
  - `appOrigin(): string` — `APP_URL || NEXT_PUBLIC_APP_URL || "http://localhost:3000"`, trailing slash stripped.
  - `type EmailTone = "mint" | "peach" | "lemon" | "sky"`
  - `EMAIL_PALETTE` (constant, values from Global Constraints)
  - `interface EmailListRow { label: string; badge: string; tone: EmailTone }`
  - `interface EmailContent { tone: EmailTone; title: string; subtitle?: string | null; paragraphs?: string[]; list?: { heading: string; rows: EmailListRow[] }[]; note?: string | null; cta?: { label: string; url: string } | null; footer: { reason: string; manageUrl?: string | null; muteUrl?: string | null }; preheader: string }`
  - `renderEmail(c: EmailContent): { html: string; text: string }`

- [ ] **Step 1: Write failing tests** in `email-layout.test.ts`:
  - `escapes caller strings in html, keeps them raw in text` — title `Ship <img src=x onerror=alert(1)> "now"` → html contains `&lt;img` and `&quot;now&quot;`, not `<img src=x`; text contains the raw title.
  - `uses the tone's surface and ink in the header` — tone `peach` → html contains `#ffe4d6` and `#9a3412`.
  - `renders logo + eSpace Hubs wordmark` — html contains `/brand/png/mark-128.png` and `Hubs`; does not contain `Dev Hub`.
  - `cta renders a button and a text line` — html contains the url in an `href`; text contains `Open the goal: https://x/n/1`.
  - `no cta → no button` — html has no `border-radius:999px` anchor.
  - `list renders headings and badges` — two groups → both headings + every row label in html and text.
  - `footer shows manage and mute links only when given` — `muteUrl` null → no "Mute this kind".
  - `preheader is hidden text at the top of body`.
- [ ] **Step 2: Run** `cd apps/api && npx tsx --test src/lib/email-layout.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `app-url.ts` and `email-layout.ts`. Table-based markup (`role="presentation"`), every style inline, `bgcolor` attribute alongside `background` on canvas/card/header cells. One private `esc()` (move the one from `email-templates.ts` here and export it for Task 2). Text body: title, subtitle, blank line, paragraphs, list as `Heading:` + `  - label — badge`, note, `CTA label: url`, then `—` + footer reason + manage url.
- [ ] **Step 4: Run** the test — PASS. Run `npx tsc --noEmit -p .` — clean.
- [ ] **Step 5: Commit** `feat(api): branded email layout`

### Task 2: Account + digest templates on the layout

**Files:**
- Modify: `apps/api/src/lib/email-templates.ts` (rewrite bodies, keep exports)
- Modify: `apps/api/src/scheduler/jobs.ts:~558-593` (digest uses `renderDigestEmail`)
- Test: `apps/api/src/lib/email-templates.test.ts`
- Modify: `apps/api/package.json` test list

**Interfaces:**
- Consumes: `renderEmail`, `EmailContent`, `appOrigin` (Task 1)
- Produces:
  - `renderInviteEmail(vars)` / `renderPasswordResetEmail(vars)` — signatures unchanged, return `{ subject, text, html }`.
  - `interface DigestItem { title: string; when: string }`
  - `renderDigestEmail(v: { week: string; overdue: DigestItem[]; dueSoon: DigestItem[]; approvals: number; sharedOwed: number; unread: number }): { subject: string; text: string; html: string }`

- [ ] **Step 1: Write failing tests:**
  - `invite: sky tone, Activate your account cta, expiry note, subject "You're invited to <org> on eSpace Hubs"`.
  - `reset: sky tone, Reset your password cta, ip/browser in subtitle when given, subject "Reset your eSpace Hubs password"`.
  - `digest: title "Your week · W46", subtitle "2 overdue · 3 due this week · 1 approval", groups Overdue (peach badges) / Due this week (lemon) / Waiting on you (only when approvals>0), cta "Open eSpace Hubs" → appOrigin()`.
  - `digest caps each group at 10 rows`.
  - `digest subject keeps today's shape`: `eSpace Hubs weekly — 2 overdue, 3 due this week`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/email-templates.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Footer reasons: invite "Someone at <org> invited this address.", reset "A password reset was requested for this address.", digest "This is your Monday summary." Digest `manageUrl` = `${appOrigin()}/email-settings`; account emails have no manage/mute links. In `jobs.ts` replace the `lines` array + `sendEmail({text})` with `sendEmail(renderDigestEmail({...}))` — keep the `emailAllowed` check and all counting logic untouched.
- [ ] **Step 4: Run** tests + `npx tsc --noEmit -p .` — PASS.
- [ ] **Step 5: Commit** `feat(api): account and digest emails use the branded layout`

### Task 3: Per-kind email config + send decision

**Files:**
- Create: `apps/api/src/lib/notification-email.ts`
- Test: `apps/api/src/lib/notification-email.test.ts`
- Modify: `apps/api/package.json` test list

**Interfaces:**
- Consumes: `renderEmail`, `EmailTone`, `appOrigin` (Task 1); `ResolvedNotificationPrefs`, `isMutableKind` (`lib/notifications.ts`); `NotificationKind`, `ALL_NOTIFICATION_KINDS` (`db/types.ts`)
- Produces:
  - `NOTIFICATION_EMAIL: Record<NotificationKind, { tone: EmailTone; cta: string; reason: string; subtitle?: (data: Record<string, unknown> | null) => string | null }>`
  - `decideNotificationEmail(i: { prefs: ResolvedNotificationPrefs; kind: NotificationKind; optOut: boolean; recipient: { email?: string | null; status?: string } | null }): { send: true } | { send: false; skip: "caller-opt-out" | "email-off" | "muted" | "no-recipient" }`
  - `renderNotificationEmail(n: { _id: ObjectId; kind; title; body; data }): { subject: string; text: string; html: string }` — subject = `n.title`; header title = `n.title`; paragraph = `n.body`; cta url `${appOrigin()}/n/${id}`; manage `${appOrigin()}/email-settings`; mute = same url for mutable kinds, null for unmutable.

Tones and CTAs (copy exactly):

| kind | tone | cta |
|---|---|---|
| goal_submitted, approval_waiting | lemon | Review tracker |
| approval_queue_stale | lemon | Open approvals |
| user_pending_approval | lemon | Review sign-up |
| review_packet_submitted | lemon | Open packet |
| github_publish_requested, goal_stale | lemon | Open the goal |
| goal_due_soon | lemon | Log it |
| assigned_goal_due_soon | lemon | Fill it in |
| goal_overdue | peach | Log it |
| assigned_goal_overdue | peach | Fill it in |
| goal_changes_requested | peach | Edit tracker |
| verdict_disputed | peach | Open their board |
| goal_approved, manager_graded | mint | Open the goal |
| github_issues_published, github_issue_closed | mint | Open progress |
| assigned_goal_assigned | sky | Open the goal |
| assigned_goal_shared, assigned_goal_period_report | sky | Open progress |
| assigned_goal_updated | sky | See what changed |
| tier_policy_updated | sky | See the criteria |
| manager_changed | sky | Open eSpace Hubs |

Reasons: approver kinds "You approve goals for your team." · admin kinds (`user_pending_approval`) "You're an admin of your org." · own-goal kinds "You submitted this goal." / "Reminders are on for your goals." · shared-goal creator kinds "You created this shared goal." · assignee kinds "This goal was shared with you." · `manager_changed` "Your reporting line changed." · `verdict_disputed` "You set this grade." · `tier_policy_updated` "This policy grades one of your goals." · `review_packet_submitted` "Someone on your team submitted a packet." · `manager_graded` "Your manager graded your goal." Subtitles: only where `data` already holds the field (e.g. `goalTitle`, `periodKey`); otherwise omit the function.

- [ ] **Step 1: Write failing tests:**
  - `every kind has an email config` — `ALL_NOTIFICATION_KINDS.every(k => NOTIFICATION_EMAIL[k])`.
  - `caller opt-out wins` → `{send:false, skip:"caller-opt-out"}`.
  - `email pref off → email-off` (even for an unmutable kind).
  - `muted mutable kind → muted`.
  - `unmutable kind in muted list still sends` (`goal_submitted`).
  - `recipient null / no email / status other than "active" (e.g. "invited", "pending_admin") → no-recipient`.
  - `active recipient, defaults → send`.
  - `renderNotificationEmail: cta points at /n/<id>, mute link absent for goal_submitted, present for goal_due_soon, title escaped`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the table and both functions. Order of checks in `decideNotificationEmail`: caller-opt-out → no-recipient → email-off → muted.
- [ ] **Step 4: Run** tests + tsc — PASS.
- [ ] **Step 5: Commit** `feat(api): per-kind notification email config`

### Task 4: createNotification emails; remove duplicate senders

**Files:**
- Modify: `apps/api/src/lib/notifications.ts:113-150` (`createNotification`)
- Modify: `apps/api/src/lib/admin-notify.ts` (drop email half; map `inboxOnly` → `email: false`)
- Modify: `apps/api/src/scheduler/assigned-goals-job.ts:129-139` (delete user lookup + `sendEmail`; drop now-unused imports)
- Test: extend `apps/api/src/lib/notification-email.test.ts` only if a new pure helper is extracted; otherwise rely on Task 3 coverage + tsc

**Interfaces:**
- Consumes: `decideNotificationEmail`, `renderNotificationEmail` (Task 3); `sendEmail` (`lib/email.ts`); `getUsersCollection`
- Produces: `CreateNotificationInput` gains `email?: boolean` (default `true`; `false` = inbox only).

- [ ] **Step 1: Implement.** After `insertOne(doc)` succeeds: `void emailNotification(doc, prefs, input.email === false)` — a private async fn that loads `{ email, status }` for `doc.userId` within `doc.orgId`, calls `decideNotificationEmail` (reuse the `prefs` already read — no second read), and on `send` calls `sendEmail(renderNotificationEmail(doc))`. Wrap in try/catch → `logger.warn({kind, userId, err}, "[notifications] email failed")`. A skip logs at `debug` with the skip reason.
- [ ] **Step 2: admin-notify.** Remove `emailAllowed` + `sendEmail` from the per-admin loop; pass `email: !input.inboxOnly` to `createNotification`. Keep `inboxOnly` in its input type (one caller: `route-approval.ts:124`).
- [ ] **Step 3: assigned-goals-job.** Delete the `users.findOne` + `sendEmail` block after the overdue `createNotification`; remove the `sendEmail` import if unused.
- [ ] **Step 4: Verify** `npx tsc --noEmit -p . && npm test -w apps/api` — all green. `grep -rn "sendEmail(" apps/api/src | grep -v "lib/email.ts"` shows only `scheduler/jobs.ts` (digest).
- [ ] **Step 5: Commit** `feat(api): every notification emails through createNotification`

### Task 5: GET /notifications/:id

**Files:**
- Modify: `apps/api/src/modules/notifications/controller.ts` (add `getNotificationHandler`)
- Modify: `apps/api/src/modules/notifications/routes.ts` (register after `/preferences`, before nothing else that matches `/:id`)
- Modify: `packages/api-contracts` notification response type if one exists for list rows (reuse it, no new shape)

**Interfaces:**
- Produces: `GET /api/v1/notifications/:id` → `200 { notification: <same row shape as the list endpoint> }`; `404 { error: "not_found" }` when the id is invalid, absent, or not owned by `req.user` (same org + userId). `requireAuth()`.

- [ ] **Step 1: Implement** using the list handler's row serializer (extract it to a shared function in the controller if it is inline). Query `{ _id, orgId: user.orgId, userId: user._id }`.
- [ ] **Step 2: Verify** `npx tsc --noEmit -p .`; run the API locally (`doppler run -- npm run dev -w apps/api` or with `apps/api/.env`) and `curl` with a session cookie: own id → 200, random ObjectId → 404, `abc` → 404.
- [ ] **Step 3: Commit** `feat(api): read a single notification`

### Task 6: Web `/n/[id]` and `/email-settings`

**Files:**
- Create: `apps/web/src/features/notifications/email-target.js` (pure)
- Test: `apps/web/src/features/notifications/email-target.test.js`
- Create: `apps/web/src/features/notifications/email-link-redirect.jsx` (client component)
- Create: `apps/web/src/app/n/[id]/page.jsx`, `apps/web/src/app/email-settings/page.jsx` (thin)
- Modify: `apps/web/src/features/notifications/index.js` (export `EmailLinkRedirect`), `apps/web/src/lib/api-client.js` only if a `getNotification` helper is the local convention
- Modify: `apps/web/package.json` `test:regression` list

**Interfaces:**
- Consumes: `notificationPath` (`notification-kinds.js`); `useAvailableHubs`, `getValidPick` (`features/hubs` barrel — both already exported); `AuthGuard` (`features/auth`)
- Produces:
  - `resolveEmailTarget({ row, hubs, pick, primaryHubId }): string` — returns a hub-prefixed path. Path = `notificationPath(row) ?? "/notifications"` (or the literal `"/settings?tab=notifications"` when `row` is the sentinel `"settings"`). Hub = the first of: a hub that owns the path's first segment (`/users` → `admin`, `/approvals` → `manager` then `admin`, if in `hubs`), `pick`, `primaryHubId`, `hubs[0].id`.
  - `<EmailLinkRedirect id={string} />` and `<EmailLinkRedirect settings />`

- [ ] **Step 1: Write failing tests** (`email-target.test.js`):
  - `goal kind → <pick hub>/goals?...` (whatever `notificationPath` returns, prefixed).
  - `user_pending_approval for an admin+dev user → /admin/users` even when pick is `dev`.
  - `goal_submitted for manager+dev → /manager/approvals`.
  - `row null (404) → /<hub>/notifications`.
  - `settings sentinel → /<hub>/settings?tab=notifications`.
  - `single-hub user → that hub`.
- [ ] **Step 2: Run** `cd apps/web && npx tsx --test src/features/notifications/email-target.test.js` — FAIL.
- [ ] **Step 3: Implement** `email-target.js`, then `email-link-redirect.jsx`: inside `<AuthGuard>` (it already bounces to `/login?next=<pathname>`), fetch `GET /api/v1/notifications/:id` (404 → row null), fire-and-forget `POST /:id/read` on success, wait for hubs `status === "ready"`, then `router.replace(resolveEmailTarget(...))`. Render the same `var(--bg)` placeholder as `RootGate` while waiting. Pages are `export default function Page({ params })` wrappers that `await params` per Next 16.
- [ ] **Step 4: Run** the test, `npm run test:regression -w apps/web` (includes design-system guard + architecture boundaries) — PASS.
- [ ] **Step 5: Commit** `feat(web): email links open the right page`

### Task 7: Preview script + docs

**Files:**
- Create: `apps/api/scripts/email-preview.ts`
- Modify: `apps/api/package.json` (`"email:preview": "tsx scripts/email-preview.ts"`), root `.gitignore` (`apps/api/.email-preview/`)
- Modify: `CLAUDE.md` Notifications row; `apps/api/.env.example` comment noting all notification kinds email

**Interfaces:**
- Consumes: `renderNotificationEmail`, `NOTIFICATION_EMAIL` (Task 3); `renderInviteEmail`, `renderPasswordResetEmail`, `renderDigestEmail` (Task 2)

- [ ] **Step 1: Implement** the script: for each of `ALL_NOTIFICATION_KINDS` build a sample row (title/body copied from the gallery wording in the spec's reference mockups), plus invite/reset/digest; write `<kind>.html` and an `index.html` linking them all to `apps/api/.email-preview/`.
- [ ] **Step 2: Verify** `npm run email:preview -w apps/api` → 28 files + index; open `index.html` and compare against `.superpowers/brainstorm/4323-1794211809/content/all-emails.html`.
- [ ] **Step 3: Send one real email** from a local API with SMTP env set (trigger a password reset for your own account) and check it in Gmail web + iOS Mail.
- [ ] **Step 4: Commit** `chore(api): email preview script and docs`
