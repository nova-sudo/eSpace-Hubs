# Frictionless signup — design

Date: 2026-11-09 · Status: approved in chat, pending spec review

## Intent

Onboarding a batch of eSpace engineers should take minutes, not an admin
round-trip. SMTP is now configured in prod, so email ownership can be proven
by a link instead of a hand-distributed signup code.

Success = a person with an `@espace.com.eg` address goes from `/signup` to
their dev hub with no admin involvement: sign up → click emailed link →
enrol TOTP → onboarding form → hub. Afterwards they are not asked for a TOTP
code on every login from the same browser.

### Decisions (from the user)

1. `@espace.com.eg` signs up with **no signup code**; email link proves ownership.
2. Other domains **still need a signup code**, and are also auto-activated once verified.
3. **Admin account approval is removed for everyone.**
4. TOTP stays mandatory at enrolment; a **trusted browser skips the prompt for 30 days**.

Not changing: admin invites (the invite link already proves ownership),
password reset, goal (BYO tracker) approvals.

## 1. Signup + email verification

### Free domains

- Env `SIGNUP_FREE_DOMAINS` — comma-separated, default `espace.com.eg`.
- Match: lower-cased part after the last `@`, exact equality. Subdomains do not match.
- Pure helper `isFreeSignupDomain(email, domains)` in `packages/shared` so the
  web form and the API use the same rule. The API is the authority.

### API — `POST /api/v1/auth/signup`

- `signupSchema.signupCode` becomes optional.
- Free domain → code ignored (not required, not counted).
  Other domain → existing code lookup; missing/invalid → `400 invalid_signup_code`.
  New error `400 signup_code_required` when the code is absent for a non-free domain,
  so the form can reveal the field.
- New user doc: `status: "pending_email"`, `role: "member"` (legacy field),
  `roles: ["dev"]`, `allowedHubs: ["dev"]`, `primaryHub: "dev"`,
  `managerId: null`, `emailVerifiedAt: null`. Everything else as today.
- Mint `auth_tokens` row, new kind `email_verify`, TTL 24h, via existing `mintToken`
  (which already deletes prior tokens of the same kind for the user).
- Send email via `emailService` (best-effort, like invite/reset) with link
  `${APP_URL}/verify-email?token=<token>`. New template in `lib/email-templates.ts`.
- Session minted as today (`totpVerified: true, totpEnrolled: false`).
- Audit: `user.signup` with `{ email, freeDomain: boolean, signupCodeUsed? }`.

### API — new routes

- `POST /api/v1/auth/verify-email` `{ token }` (public): `redeemToken(token, "email_verify")`.
  On success: set `status: "active"`, `emailVerifiedAt: now`, `updatedAt`;
  only transitions from `pending_email` (an already-active user is a no-op success).
  Returns `{ user }`. Invalid/expired → `400 invalid_token`. Audit `user.email_verified`.
  If the request carries a session for that user, the session stays valid;
  otherwise the user logs in normally.
- `POST /api/v1/auth/resend-verification` (auth, allowed for `pending_email`):
  re-mints + re-sends. Rate limit 1/min and 5/hour per user (existing `lib/rate-limit.ts`).
  Always `{ ok: true }` for a `pending_email` user; `409 already_verified` otherwise.

### Gating

- `requireAuth` (or the status check it already does for `pending_admin`) treats
  `pending_email` the same way: only `GET /auth/me`, `POST /auth/logout`,
  `POST /auth/resend-verification` are allowed. Everything else → `403 email_unverified`.
- Login (`POST /auth/login`) accepts `pending_email` users (they have a password),
  same as `pending_admin` today.

### Web

- `signup-form.jsx`: signup-code field hidden while the email matches a free domain
  (`isFreeSignupDomain`), shown otherwise or when the server returns
  `signup_code_required`. Lead copy no longer says a code is always needed.
- `/waiting-approval` page is replaced by `/verify-email-pending`
  ("Check your inbox — we sent a link to x@…", Resend button with cooldown,
  "Wrong email? Sign out"). `/waiting-approval` redirects there for old links.
- New `/verify-email?token=…` page: calls the verify route, then routes on to
  the normal AuthGuard chain (`/totp-setup` → `/onboarding` → hub), or to
  `/login?verified=1` if there is no session.
- `auth-guard.jsx`: `pending_email` → `/verify-email-pending` (checked before
  the TOTP/onboarding gates). The `pending_admin` branch is removed.

## 2. Remove admin account approval

- Nothing assigns `pending_admin` anymore. The value stays in `UserStatus` and the
  `$jsonSchema` validator so old rows validate. Migration in `db/migrations/`:
  `pending_admin` → `active` (0 rows in prod today; idempotent).
- `modules/onboarding/controller.ts`: the `pending_admin` branch (admin "waiting"
  notification) becomes a "new user joined" notice to org admins, sent on
  onboarding completion for self-signups, so admins know to set a manager / roles.
- Admin hub (`admin-lib.js`, `admin-users.jsx`, `admin-dashboard.jsx`,
  `roster-controller.ts`): "Pending approval" status / filter / count become
  **"Unverified"** (`pending_email`). Row actions: resend verification, delete.
  The approve dialog is no longer reachable for self-signups.
- `account-tab.jsx` status label: `pending_email: "Email not verified"`.

## 3. Trusted browser (30 days)

### Data

New collection `trusted_devices`:
`{ _id, orgId, userId, tokenHash, userAgent, ip, createdAt, lastUsedAt, expiresAt }`.
Indexes: `{ userId: 1 }`, unique `{ tokenHash: 1 }`, TTL on `expiresAt`.
Accessor in `db/collections.ts`, validator in `db/schemas/`.

### Issue

- TOTP verify at login and first-time TOTP enrolment accept `trustDevice: boolean`
  (UI default true).
- On a correct **TOTP** code with `trustDevice`: 32 random bytes → base64url token;
  store `sha256(token)`; set cookie `dh_trusted` = token, httpOnly, Secure,
  SameSite=Lax, Path=/api, Max-Age 30d (helper in `modules/auth/cookies.ts`).
- Backup-code verification never issues trust.

### Use

- In `POST /auth/login`, after the password check: if `dh_trusted` hashes to a live
  row whose `userId` matches the authenticating user, mint the session with
  `totpVerified: true`, bump `lastUsedAt`, return `needsTotp: false`.
  Otherwise current behaviour. A cookie belonging to another user is ignored (not deleted).
- Audit `auth.login` gains `trustedDevice: boolean`.

### Revoke (delete all rows for the user)

Password reset, password change, TOTP re-enrol / reset, admin disable,
"sign out everywhere". Settings → Account shows "Trusted browsers: N" with
**Forget all** (`DELETE /api/v1/auth/trusted-devices`). Logout clears the cookie
only for that browser and deletes its row.

## Testing

API unit tests (vitest, existing fake-collection support):

- domain helper: free domain, mixed case, subdomain rejected, other domain.
- signup: free domain without code → `pending_email` + token + email sent;
  other domain without code → `signup_code_required`; bad code → `invalid_signup_code`.
- verify: valid → active; reused/expired → `invalid_token`; already active → no-op.
- resend: rate limited; non-pending → 409.
- gate: `pending_email` blocked from a normal route, allowed on the three exempt ones.
- trusted device: valid cookie skips TOTP; expired row; other user's cookie;
  revoked after password reset; backup code issues no cookie.

Manual: prod signup with a real `@espace.com.eg` inbox over SMTP, full chain to hub,
log out + back in on the same browser (no TOTP), different browser (TOTP).

## Out of scope

Passwordless login, auto-assigning managers from an org chart, domain config in
the admin UI (env-only for now).
