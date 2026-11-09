# Email notifications — design

Date: 2026-11-09 · Status: draft for review

## Goal

Every in-app notification also arrives as an email (option "Mirror"), and
every email the API sends — notifications, weekly digest, invite, password
reset — shares one branded layout in the Zinc design system. Transport is
already in place: SMTP via nodemailer (Gmail App Password), configured in
Coolify (`d715db4`).

## Decisions (agreed in brainstorming)

| Topic | Decision |
|---|---|
| Volume | Mirror: all 25 notification kinds email, plus digest, invite, reset |
| Control | Existing prefs only. Muting a kind stops inbox AND email. "Email me" off stops every non-account email. Unmutable kinds (`UNMUTABLE_NOTIFICATION_KINDS`) still email unless "Email me" is off. Invite + reset always send. |
| Layout | Direction B: tinted header carries state. Logo placement A: mark + "eSpace Hubs" wordmark above the card on the grey canvas |
| Tints | lemon = waiting on you / due soon · peach = overdue, changes requested, disputed · mint = approved, graded, GitHub done · sky = info, digest, account |
| Name | Emails say **eSpace Hubs** (brand kit), replacing "eSpace Dev Hub" |
| Theme | Light only (`color-scheme: light`); no dark variant |

Reference mockups: `.superpowers/brainstorm/4323-1794211809/content/all-emails.html`
(every template with real wording).

## Architecture

### 1. `apps/api/src/lib/email-layout.ts` (new)

One pure function:

```ts
renderEmail({
  tone: "mint" | "peach" | "lemon" | "sky",
  title: string,          // header headline
  subtitle?: string,      // header second line
  paragraphs?: string[],  // body copy (escaped)
  list?: { heading: string; rows: { label: string; badge: string; tone }[] }[],
  note?: string,          // small muted line (expiry etc.)
  cta?: { label: string; url: string },
  footer: { reason: string; manageUrl?: string; muteUrl?: string },
  preheader: string,
}): { html: string; text: string }
```

- Table-based, inline styles, 560px max width, `bgcolor` fallbacks for Outlook.
- Manrope via `<link>` (Apple Mail / iOS), system sans stack fallback.
- Logo: `${APP_URL}/brand/png/mark-128.png` rendered at 28px (PNG; SVG is
  blocked by Gmail/Outlook). Wordmark is live text: "eSpace" 800 + "Hubs"
  600 muted.
- Colors are a named `EMAIL_PALETTE` constant mirroring `globals.css`
  tokens (email clients can't read CSS variables). Add `lib/email-layout.ts`
  to the design-system guard's literal-color allow-list if the guard scans
  the API.
- `text` is generated from the same input: title, subtitle, paragraphs, list
  rows, CTA as `Label: url`, footer reason.
- All interpolated strings are HTML-escaped inside the layout; callers pass
  plain text.

### 2. `apps/api/src/lib/email-templates.ts` (rewrite)

`renderInviteEmail`, `renderPasswordResetEmail` keep their signatures and
call `renderEmail` (tone sky). New `renderDigestEmail` (tone sky, grouped
list: Overdue · Due this week · Waiting on you) replaces the inline text
building in `scheduler/jobs.ts`.

### 3. Notification → email, one choke point

`createNotification` (`lib/notifications.ts`), after the inbox insert
succeeds and only if a row was written:

1. `emailAllowed(orgId, userId)` (prefs already read — reuse, don't re-read).
2. Load recipient `email` + `status` (skip if not `active` or no email).
3. Build with `NOTIFICATION_EMAIL[kind]` and `void sendEmail(...)`.

`NOTIFICATION_EMAIL: Record<NotificationKind, { tone; cta: string; reason: string; subtitle?: (data) => string | null }>`
lives in new `lib/notification-email.ts`. `Record<NotificationKind, …>`
makes a missing kind a compile error. Title/body come from the notification
itself (`title` → header headline, `body` → paragraph), so wording stays in
one place. The header subtitle comes only from the kind's optional `subtitle(data)`
reading fields callers already store in `data`; when it returns null the
header shows the title alone. (The mockups' subtitles are the target; any
kind whose `data` lacks the fields simply ships without one.)

Remove the direct `sendEmail` calls that duplicate this:

- `lib/admin-notify.ts` — drop its email half (`inboxOnly` flag becomes an
  `email: false` option on `createNotification`).
- `scheduler/assigned-goals-job.ts:134` — drop; the overdue notification now
  emails via the choke point and so honours "Email me" (fixes the current
  opt-out bug).

`createNotification` gains `email?: boolean` (default true) for callers that
must stay inbox-only.

### 4. Deep link: `/n/[id]` (web)

CTA url = `${APP_URL}/n/<notificationId>`. New thin route
`apps/web/src/app/n/[id]/page.jsx` → component in `features/notifications`:

1. Not signed in → `/login?next=/n/<id>`.
2. `POST /api/v1/notifications/:id/read` (exists).
3. Needs the row to resolve the path: add `GET /api/v1/notifications/:id`
   (own rows only, 404 otherwise).
4. `router.replace(link(notificationPath(row) ?? "/notifications"))` —
   reuses `notification-kinds.js`, no path logic duplicated in the API.

"Manage emails" and "Mute this kind" → `${APP_URL}/settings?tab=notifications`
(the hub-less `/settings` must redirect to the user's hub; verify, else add
the redirect). No one-click unsubscribe tokens (YAGNI).

### 5. Error handling

Email is best-effort everywhere: failures log `[email] smtp send threw` at
warn and never fail the inbox write or the triggering request. Prefs read
failure keeps today's fail-open behaviour. Auth flows keep their existing
"always 200" contract.

## Testing

- `email-layout.test.ts`: escaping (title with `<script>`), text fallback
  contains CTA url, no CTA → no button, list rendering, tone colors.
- `notification-email.test.ts`: every `ALL_NOTIFICATION_KINDS` entry has a
  config (runtime twin of the type check).
- `notifications.test.ts`: email sent on insert; not sent when kind muted,
  when the user's "Email me" pref is off, when the caller passes
  `email: false`, when the user is inactive;
  unmutable kind muted in prefs still emails.
- Web: `/n/[id]` resolves via `notificationPath`, falls back to
  `/notifications` on 404.
- `npm run email:preview -w apps/api` writes every template (all kinds +
  digest + invite + reset) to `apps/api/.email-preview/*.html` (gitignored)
  with sample data, for visual review before shipping.

## Out of scope

Per-kind email-only toggles, one-click unsubscribe, dark-mode email, email
batching/throttling, localisation.
