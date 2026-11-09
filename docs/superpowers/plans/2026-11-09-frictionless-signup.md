# Frictionless Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@espace.com.eg` users self-onboard with an emailed verification link (no signup code, no admin approval), and a verified browser skips the TOTP prompt for 30 days.

**Architecture:** New user status `pending_email` gated by a session flag `emailVerified` checked in `requireAuth`. Verification reuses `auth_tokens` (`email_verify` kind) and the existing SMTP `emailService`. Trusted browsers are a new `trusted_devices` collection keyed by a hashed random cookie token. Business logic lives in small deps-injected modules (the repo's `totp-reenrol.ts` pattern) so it is testable with in-memory fakes; controllers only wire them.

**Tech Stack:** Express + zod + MongoDB driver (API, TypeScript, `tsx --test` with `node:test`), Next.js 16 JSX (web), `packages/shared` plain JS + `.d.ts`.

**Spec:** `docs/superpowers/specs/2026-11-09-frictionless-signup-design.md`

## Global Constraints

- Free domains: env `SIGNUP_FREE_DOMAINS`, comma-separated, default `espace.com.eg`; exact, case-insensitive match on the part after the last `@`; subdomains do NOT match.
- Self-signup defaults: `status: "pending_email"`, `role: "member"`, `roles: ["dev"]`, `allowedHubs: ["dev"]`, `primaryHub: "dev"`, `managerId: null`, `emailVerifiedAt: null`.
- Verification token: kind `email_verify`, TTL 24h. Link: `${APP_URL}/verify-email?token=<token>` (use the same app-origin env the invite email uses).
- Resend limits: 1 per minute AND 5 per hour, per user.
- Trusted cookie: name `dh_trusted`, 32 random bytes base64url, httpOnly, Secure in prod, SameSite=Lax, signed, path `/` (same base options as `devhub_sid`), Max-Age 30 days. Only `sha256(token)` is stored.
- Backup-code verification never issues a trusted cookie.
- `pending_admin` stays in `UserStatus` / validators but is never assigned.
- Web copy follows `docs/design-system-v2.md` (sentence case, `Button`/`Card`/`Field` primitives, no hex). Every new API test file is appended to `apps/api/package.json` `test`; every new web test file to `apps/web/package.json` `test:regression`.
- Commits use repo-local identity `Abdelrahman Noaman <114813236+nova-sudo@users.noreply.github.com>`.

## Review Focus

1. Emails with odd casing/whitespace (`Ahmed@ESPACE.com.eg`) must count as free; lookalikes (`x@evil-espace.com.eg`, `x@espace.com.eg.evil.com`) must not. → Task 1 tests.
2. Link opened on a different device (phone) with no session: the laptop session that is waiting must unblock without re-login. → Task 3 test `verify flips every session of the user`.
3. Link clicked twice, or after the user is already active (mail scanners, double-click): user sees "already verified" and continues, not an error dead-end. → Task 3 test + Task 7 page behaviour.
4. SMTP failure at signup must not fail the signup; the user can resend from the inbox screen. → Task 2 test `signup succeeds when email send fails`.
5. A trusted cookie must stop working after password reset / TOTP re-enrol / disable, and must never authenticate a different user. → Task 5 tests.

---

### Task 1: Shared free-domain helper

**Files:**
- Create: `packages/shared/src/auth/signup-domain.js`, `packages/shared/src/auth/index.js`, `packages/shared/src/auth/index.d.ts`
- Modify: `packages/shared/package.json` (add `"./auth"` export, same shape as `"./hubs"`)
- Test: `packages/shared/src/auth/signup-domain.test.js`

**Interfaces:**
- Produces: `parseFreeDomains(raw: string | undefined): string[]` (lower-cased, trimmed, empties dropped; `undefined`/empty → `["espace.com.eg"]`) and `isFreeSignupDomain(email: string, domains: string[]): boolean`, both exported from `@espace-devhub/shared/auth`.

- [ ] **Step 1: Write failing tests** — `isFreeSignupDomain`: `"a@espace.com.eg"` true; `" Ahmed@ESPACE.com.eg "` true; `"a@sub.espace.com.eg"` false; `"a@evil-espace.com.eg"` false; `"a@espace.com.eg.evil.com"` false; `"a@gmail.com"` false; `""` false. `parseFreeDomains(undefined)` → `["espace.com.eg"]`; `parseFreeDomains(" Espace.com.eg, espace.com ,")` → `["espace.com.eg","espace.com"]`.
- [ ] **Step 2: Run** `node --test packages/shared/src/auth/signup-domain.test.js` — expect FAIL (module not found).
- [ ] **Step 3: Implement** both functions; domain = substring after the last `@` of the trimmed, lower-cased email.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat(shared): free signup domain helper`.

### Task 2: Signup without code for free domains

**Files:**
- Modify: `apps/api/src/db/types.ts` (`UserStatus` + `ALL_USER_STATUSES` add `"pending_email"`; `User.emailVerifiedAt: Date | null`; `AuthTokenKind` + `ALL_AUTH_TOKEN_KINDS` add `"email_verify"`; `Session.emailVerified?: boolean`)
- Modify: `apps/api/src/db/schemas/users.schema.ts` (`emailVerifiedAt: { bsonType: ["date","null"] }`), `sessions.schema.ts` (`emailVerified: { bsonType: ["bool","null"] }`)
- Modify: `apps/api/src/lib/tokens.ts` (`EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000`)
- Modify: env schema (`apps/api/src/**/env.ts`, the file with `const envSchema = z.object`) — `SIGNUP_FREE_DOMAINS: z.string().optional()`
- Modify: `apps/api/src/lib/email-templates.ts` — add `renderVerifyEmail(vars: { displayName: string; verifyUrl: string; orgName: string }): { subject: string; text: string; html: string }` mirroring `renderInviteEmail`
- Create: `apps/api/src/modules/auth/signup-policy.ts`
- Modify: `apps/api/src/modules/auth/schemas.ts` (`signupCode` → `.optional()`), `apps/api/src/modules/auth/session.ts` (`MintSessionInput.emailVerified?: boolean`, stored as `input.emailVerified ?? true`), `apps/api/src/modules/auth/controller.ts` `signupHandler`
- Test: `apps/api/src/modules/auth/signup-policy.test.ts`

**Interfaces:**
- Consumes: `isFreeSignupDomain`, `parseFreeDomains` (Task 1); `mintToken` (`lib/tokens.ts`).
- Produces:
  - `resolveSignupGate(input: { email: string; signupCode?: string; freeDomains: string[] }): { kind: "free" } | { kind: "code"; code: string }` — throws `HttpError(400, "signup_code_required", "This email domain needs a signup code from your admin.")` when not free and no code.
  - `newSelfSignupUser(input: { orgId: ObjectId; email: string; passwordHash: string; displayName: string; now: Date }): Omit<User, "_id">` with the Global Constraints defaults.
  - `sendVerificationEmail(deps: { mintToken: typeof mintToken; send: EmailService["send"]; appUrl: string; orgName: string }, user: { _id: ObjectId; orgId: ObjectId; email: string; displayName: string }, meta: { ip: string | null; ua: string | null }): Promise<EmailResult>` — mints `email_verify` with `EMAIL_VERIFY_TTL_MS` and sends `renderVerifyEmail`. Never throws on send failure.

- [ ] **Step 1: Write failing tests** — `resolveSignupGate`: free email + no code → `{kind:"free"}`; free email + code → `{kind:"free"}` (code ignored); `a@gmail.com` + `"ESP-1"` → `{kind:"code", code:"ESP-1"}`; `a@gmail.com` no code → throws code `signup_code_required`. `newSelfSignupUser` → status `pending_email`, roles `["dev"]`, allowedHubs `["dev"]`, primaryHub `"dev"`, `emailVerifiedAt: null`, `onboardingCompletedAt: null`. `sendVerificationEmail` with a fake `send` returning `{ok:false, reason:"smtp down"}` resolves `{ok:false}` (no throw) and the fake `mintToken` was called with `kind: "email_verify"`, `ttlMs: 86_400_000`; the sent `text` contains `https://app.test/verify-email?token=`.
- [ ] **Step 2: Run** `cd apps/api && npx tsx --test src/modules/auth/signup-policy.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `signup-policy.ts`, the type/schema/env/template edits, and rewire `signupHandler`: gate → (code path only) existing `$elemMatch` org lookup + `usedCount` bump; free path loads the single org (`orgs.findOne({})` — single-org deployment, same as invite flow); insert `newSelfSignupUser(...)`; `mintSession({..., totpVerified: true, totpEnrolled: false, emailVerified: false })`; `await sendVerificationEmail(...)` (log a warn on `ok:false`); audit `after: { email, freeDomain, signupCodeUsed? }`.
- [ ] **Step 4: Run** the test file and `npm run typecheck -w apps/api` — expect PASS / no errors.
- [ ] **Step 5: Commit** `feat(auth): code-free signup for free domains with verification email`.

### Task 3: Verify + resend + the `pending_email` gate

**Files:**
- Create: `apps/api/src/modules/auth/email-verification.ts`
- Modify: `apps/api/src/middleware/require-auth.ts` (option `requireEmailVerified?: boolean`, default `true`; blocks when `req.session.emailVerified === false` with `HttpError(403, "email_unverified", "Verify your email to continue.")`)
- Modify: `apps/api/src/middleware/session.ts` (surface `emailVerified` on `req.session` like `totpEnrolled`)
- Modify: `apps/api/src/middleware/rate-limit.ts` — `resendVerificationLimiter = [buildLimiter({windowMs: 60_000, max: 1, label: "verification-email", keyGenerator: (r) => \`verify-1m:${userKey(r)}\`}), buildLimiter({windowMs: 3_600_000, max: 5, label: "verification-email", keyGenerator: (r) => \`verify-1h:${userKey(r)}\`})]`
- Modify: `apps/api/src/modules/auth/routes.ts`, `controller.ts` (`loginHandler`: accept `pending_email` in `validCredentials`, pass `emailVerified: u.status !== "pending_email"`; `toPublicUser` includes `emailVerifiedAt`)
- Test: `apps/api/src/modules/auth/email-verification.test.ts`, `apps/api/src/middleware/require-auth.test.ts`

**Interfaces:**
- Consumes: `redeemToken`, `sendVerificationEmail` (Task 2).
- Produces:
  - `verifyEmail(deps: { redeem: (t: string) => Promise<AuthToken | null>; users: Pick<Collection<User>, "findOneAndUpdate" | "findOne">; sessions: Pick<Collection<Session>, "updateMany">; now: () => Date }, token: string): Promise<{ status: "verified" | "already_verified"; user: User }>` — throws `HttpError(400, "invalid_token", "This link is invalid or has expired.")`.
  - Routes: `POST /auth/verify-email` (public, `inviteAcceptLimiter`) → `{ status, user }`; `POST /auth/resend-verification` → `requireAuth({ requireEmailVerified: false, requireTotpEnrolled: false })`, `resendVerificationLimiter`, → `{ ok: true }` or `409 already_verified`.
  - `GET /auth/me` and `GET /auth/me/engagement-config` pass `requireEmailVerified: false`.

- [ ] **Step 1: Write failing tests** — `verifyEmail`: valid token for a `pending_email` user → `status: "verified"`, user `status: "active"`, `emailVerifiedAt` = `now()`, and `sessions.updateMany` called with `{ userId }` → `$set: { emailVerified: true }` (*verify flips every session of the user*); token valid but user already `active` → `"already_verified"`, user unchanged; `redeem` returns null → throws `invalid_token`. `requireAuth` test: session `{totpVerified:true, totpEnrolled:true, emailVerified:false}` → next called with 403 `email_unverified`; same with `{requireEmailVerified:false}` → next with no error; `emailVerified: undefined` (legacy) → passes.
- [ ] **Step 2: Run** `npx tsx --test src/modules/auth/email-verification.test.ts src/middleware/require-auth.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** module, middleware option, limiter, routes, login change. Audit `user.email_verified`.
- [ ] **Step 4: Run** tests + typecheck — expect PASS.
- [ ] **Step 5: Commit** `feat(auth): email verification, resend, and pending_email gate`.

### Task 4: Retire account approval

**Files:**
- Create: `apps/api/src/db/migrations/pending-admin-to-active.ts` — `migratePendingAdminToActive(users: Collection<User>): Promise<{ updated: number }>` (`updateMany({status:"pending_admin"}, {$set:{status:"active", updatedAt: now}})`); call it from `runMigrations()` in `db/collections.ts` with the same try/log shape as `migrateUserRoles`.
- Modify: `apps/api/src/modules/auth/controller.ts` (`loginHandler` and password-reset paths: replace `pending_admin` acceptance with `pending_email`)
- Modify: `apps/api/src/modules/onboarding/controller.ts:87` — notify admins when this submission is the user's first completion (`onboardingCompletedAt` was null before the update) AND `invitedBy === null`: title `"New teammate joined"`, body `` `${displayName} (${email}) signed up and finished onboarding. Set their manager and roles if needed.` ``
- Modify: `apps/api/src/modules/admin/roster-controller.ts` (counts/filter key `pending_email` instead of `pending_admin`)
- Modify: `apps/api/src/modules/admin/routes.ts` + controller — `POST /admin/users/:id/resend-verification` (`users.manage`), 409 unless `pending_email`, uses `sendVerificationEmail`.
- Test: `apps/api/src/db/migrations/pending-admin-to-active.test.ts`

- [ ] **Step 1: Write failing test** — fake collection with one `pending_admin`, one `active` → `{updated: 1}`, both `active`; second run → `{updated: 0}`.
- [ ] **Step 2: Run** `npx tsx --test src/db/migrations/pending-admin-to-active.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the listed changes. `grep -rn pending_admin apps/api/src` afterwards must show only `types.ts`, the migration, and its test.
- [ ] **Step 4: Run** test + typecheck + full `npm test -w apps/api` — expect PASS.
- [ ] **Step 5: Commit** `feat(admin): drop account approval; unverified users visible to admins`.

### Task 5: Trusted browsers (API)

**Files:**
- Modify: `apps/api/src/db/types.ts` (`TrustedDevice { _id: ObjectId; orgId; userId; tokenHash: string; userAgent: string | null; ip: string | null; createdAt: Date; lastUsedAt: Date; expiresAt: Date }`)
- Create: `apps/api/src/db/schemas/trusted-devices.schema.ts`; register in `db/schemas/index.ts`
- Modify: `apps/api/src/db/collections.ts` — `getTrustedDevicesCollection()`, indexes `{userId:1}` `trusted_devices_user`, unique `{tokenHash:1}` `trusted_devices_hash_uniq`, TTL `{expiresAt:1}` `expireAfterSeconds: 0` `trusted_devices_ttl`
- Create: `apps/api/src/modules/auth/trusted-devices.ts`
- Modify: `apps/api/src/modules/auth/cookies.ts` — `TRUSTED_COOKIE_NAME = "dh_trusted"`, `setTrustedCookie(res, token)`, `clearTrustedCookie(res)`, `readTrustedCookie(req): string | null` (from `req.signedCookies`)
- Modify: `controller.ts` — `loginHandler` (check trust after password ok), `totpVerifyLoginHandler` + `totpVerifyEnrolmentHandler` (accept `trustDevice?: boolean` in their zod schemas; issue on TOTP success only), `logoutHandler` (forget this browser), revoke-all in `passwordResetHandler`, password change in `updateMeHandler`, `totpReenrolConfirmHandler`, `totpDisableHandler`; `apps/api/src/modules/admin/controller.ts:240` (disable)
- Modify: `routes.ts` — `GET /auth/trusted-devices` → `{ count }`, `DELETE /auth/trusted-devices` → revoke all + clear cookie (both `requireAuth()`)
- Test: `apps/api/src/modules/auth/trusted-devices.test.ts`

**Interfaces:**
- Produces:
  - `TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000`
  - `issueTrustedDevice(store, input: { orgId; userId; ip; userAgent; now: Date }): Promise<string>` → plaintext token
  - `checkTrustedDevice(store, token: string | null, userId: ObjectId, now: Date): Promise<boolean>` — true only for a live row whose `userId` equals; bumps `lastUsedAt`
  - `revokeTrustedDevices(store, userId: ObjectId): Promise<number>`; `forgetTrustedDevice(store, token: string): Promise<void>`; `countTrustedDevices(store, userId, now): Promise<number>`
  - `store` = `Pick<Collection<TrustedDevice>, "insertOne" | "findOneAndUpdate" | "deleteMany" | "deleteOne" | "countDocuments">`

- [ ] **Step 1: Write failing tests** — issue then check same user → true and `lastUsedAt` bumped; check with a different `userId` → false and row still present; row with `expiresAt` in the past → false; `revokeTrustedDevices` then check → false (*revoked after password reset*); stored doc has `tokenHash` = sha256 hex of the token and never the token itself; `checkTrustedDevice(store, null, …)` → false.
- [ ] **Step 2: Run** `npx tsx --test src/modules/auth/trusted-devices.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** module + wiring. Login: when `needsTotp && await checkTrustedDevice(...)`, mint with `totpVerified: true`, respond `needsTotp: false`, audit `after: { needsTotp, trustedDevice: true }`.
- [ ] **Step 4: Run** tests + typecheck + `npm test -w apps/api` — expect PASS.
- [ ] **Step 5: Commit** `feat(auth): trust a browser for 30 days after TOTP`.

### Task 6: Web — signup form + inbox + verify pages + guard

**Files:**
- Modify: `apps/web/src/features/auth/signup-form.jsx` — hide the "Signup code" `Field` while `isFreeSignupDomain(email, FREE_DOMAINS)`; show it on non-free email or when the API returns `signup_code_required`; lead copy: "Map your goals, connect your sources, and build review-ready evidence. Use your eSpace email — we'll send you a link to confirm it." Error map adds `signup_code_required`.
- Create: `apps/web/src/features/auth/free-domains.js` — `FREE_DOMAINS = parseFreeDomains(process.env.NEXT_PUBLIC_SIGNUP_FREE_DOMAINS)`
- Create: `apps/web/src/features/auth/verify-email-pending.jsx` (replaces `waiting-approval.jsx`): title "Check your inbox", body "We sent a link to {email}. Open it to finish setting up your account.", `Button` "Resend link" (calls `/auth/resend-verification`, 60s cooldown, toast on 429 "Wait a minute before asking again."), secondary "Use a different email" → logout → `/signup`.
- Create: `apps/web/src/features/auth/verify-email-view.jsx` + `apps/web/src/app/verify-email/page.jsx` — on mount POST `/auth/verify-email` with `token`; `verified`/`already_verified` → `refreshSilent()` then `router.replace("/")` (guard routes to TOTP/onboarding) or `/login?verified=1` when no session; `invalid_token` → if session user is `active`, `router.replace("/")`; else message "This link has expired or was already used." + "Send a new link" (only with a session) / "Sign in" link.
- Create: `apps/web/src/app/verify-email-pending/page.jsx`; Modify `apps/web/src/app/waiting-approval/page.jsx` → `redirect("/verify-email-pending")`
- Modify: `apps/web/src/features/auth/auth-guard.jsx` — `pending_email` → `/verify-email-pending`, evaluated before the TOTP and onboarding gates; remove the `pending_admin` branch; `/verify-email` is a public path.
- Modify: `apps/web/src/features/auth/index.js` barrel; `apps/web/src/features/onboarding/onboarding-page.jsx` (drop the "Approval" step)
- Modify: `apps/web/src/features/auth/login-form.jsx` — show "Email confirmed — sign in to continue." when `?verified=1`
- Test: `apps/web/src/features/auth/auth-guard-route.test.js`

**Interfaces:**
- Consumes: `@espace-devhub/shared/auth` (Task 1); routes from Task 3.
- Produces: pure `guardTarget({ user, pathname }): string | null` extracted from `auth-guard.jsx` (the redirect decision), tested directly.

- [ ] **Step 1: Write failing test** — `guardTarget`: `pending_email` user on `/dev` → `/verify-email-pending`; same user on `/verify-email-pending` → null; same user on `/verify-email` → null; `active` user without TOTP → `/totp-setup`; `active` enrolled user without onboarding → `/onboarding`; signed-out on `/verify-email` → null.
- [ ] **Step 2: Run** `cd apps/web && npx tsx --test src/features/auth/auth-guard-route.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the listed changes.
- [ ] **Step 4: Run** the test + `npm run test:regression -w apps/web` (includes design-system guard + architecture boundaries) — expect PASS.
- [ ] **Step 5: Commit** `feat(web): code-free signup, inbox screen, verify-email page`.

### Task 7: Web — trust checkbox, trusted browsers setting, admin labels

**Files:**
- Modify: `apps/web/src/features/auth/login-form.jsx` (TOTP step) and `totp-setup-form.jsx` — `Checkbox` "Trust this browser for 30 days", default checked, sends `trustDevice`; hidden when the user switches to a backup code.
- Modify: `apps/web/src/features/auth/use-session.js` — `verifyTotp(code, { trustDevice })` passes it through.
- Modify: `apps/web/src/features/settings/tabs/account-tab.jsx` — row "Trusted browsers: {count}" (GET `/auth/trusted-devices`) with `Button` "Forget all" (DELETE, toast "Trusted browsers cleared. You'll be asked for a code next time."); status label `pending_email: "Email not verified"` replacing `pending_admin`.
- Modify: `apps/web/src/hubs/admin/admin-lib.js` (`ALL_STATUSES`, label `pending_email: { label: "Unverified", tone: "lemon" }`, filter option), `admin-dashboard.jsx` (count key), `admin-users.jsx` / `admin-user-panel.jsx` (row action "Resend link" → `POST /admin/users/:id/resend-verification`; approve action not offered for `pending_email`).
- Modify: `apps/web/src/features/settings/` privacy copy and `CLAUDE.md` "What's real" table — add a line for verification email + trusted browsers (CLAUDE.md rule 4 says keep the two in sync).

- [ ] **Step 1: Implement** the listed changes.
- [ ] **Step 2: Run** `npm run test:regression -w apps/web` and `npm run build -w apps/web` — expect PASS.
- [ ] **Step 3: Commit** `feat(web): trust-browser option, trusted browsers setting, unverified admin view`.

### Task 8: End-to-end check

- [ ] **Step 1:** Set `SIGNUP_FREE_DOMAINS=espace.com.eg` (API) and `NEXT_PUBLIC_SIGNUP_FREE_DOMAINS=espace.com.eg` (web) in Coolify env; confirm SMTP vars present.
- [ ] **Step 2:** Run API + web locally against a scratch DB (`docs/RUN_LOCALLY.md`); sign up `someone@espace.com.eg` with no code → inbox screen; open the logged link → TOTP setup (trust checked) → onboarding → dev hub; admin gets "New teammate joined".
- [ ] **Step 3:** Log out, log in on the same browser → no TOTP prompt. Private window → TOTP prompt. Settings → "Forget all" → next login prompts.
- [ ] **Step 4:** Sign up `x@gmail.com` without code → code field appears with `signup_code_required` message.
- [ ] **Step 5:** `npm test -w apps/api`, `npm run typecheck -w apps/api`, `npm run test:regression -w apps/web` all green; report results.
