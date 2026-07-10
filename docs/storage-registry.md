# Storage registry

Every key that touches browser storage or a server-backed store lives here.
When you add a new store, add a row. When you remove one, strike it through
and note when it was deprecated.

The authoritative "what to wipe on logout" list is the `USER_SCOPED_KEYS`
constant in `apps/web/src/features/auth/clear-user-storage.js`. Keep that
list and the "User-scoped" column here in sync.

---

## localStorage — active

| Key | Owner | User-scoped | Notes |
|---|---|---|---|
| `espace-devhub:integrations` | `features/integrations/integrations-store.js` | ✅ | Provider tokens (Jira URL/token, GitLab URL/token, GitHub token). Plain object, encrypted at the field level by the browser session. Never sent to the server. |
| `espace-devhub:snapshots` | `features/snapshots/snapshots-store.js` | ✅ | Array of weekly snapshot objects. Schema: `{ week, capturedAt, capturedBy, merged, reviews, turnaround, linkage, rounds, note, goalReadings, partial, gaps }`. |
| `espace-devhub:evidence` | `features/evidence/evidence-store.js` | ✅ | Starred evidence items (MR links, ticket keys, etc.) for the current review period. |
| `espace-devhub:goal-specs` | `features/goal-specs/specs-store.js` | ✅ | AI-classified goal specs. Populated by the analyst flow; read by goal widgets. |
| `espace-devhub:goal-context` | `features/goal-context/` | ✅ | User's context-question answers keyed by spec ID. |
| `espace-devhub:goal-inputs` | `features/goal-inputs/inputs-store.js` | ✅ | User's numeric readings for input-type goals (e.g. "CSAT score this week"). |
| `espace-devhub:chat` | `features/chat/use-chat.js` | ✅ | Persisted chat conversation thread (messages array). Cleared on logout so the thread doesn't leak across accounts. |
| `espace-devhub:last-seen` | `features/dashboard/last-seen-store.js` | ✅ | Timestamp used by new-item badge logic. User-scoped because "new" means "new to this user." |
| `espace-devhub:active-hub-pick` | `features/hubs/hub-pick-store.js` | ✅ | Active hub slug the user last selected. |
| `espace-devhub:migrate-completed-by-user` | `features/migrate/migrate-store.js` | ✅ | Flag set after the one-time migration wizard completes for a given user ID. |
| `espace-devhub:review-timing-cache` | `features/integrations/hooks/use-pr-review-timings.js` | ✅ | SWR-level cache for PR review timing data. Cleared on logout to avoid stale cross-user data. |
| `espace-devhub:goal-tiers` | `features/goal-tiers/goal-tier-store.js` | ✅ | AI tier verdict cache keyed by `(goalId, rubricHash)`. Expensive to recompute; invalidated by logout and by a new spec classification. |
| `espace-devhub:goal-locks` | `features/goal-locks/locks-store.js` | ✅ | Per-goal-per-window "finalised" flags (`{goalId::windowKey: true}`). Lets the user settle a goal window so the status model stops treating it as owed. Device-local (localStorage-first, like prefs were) — promote to API-direct for cross-device sync. |
| ~~`espace-devhub:dashboard-view`~~ | ~~`features/dashboard/use-dashboard-view.js`~~ | ❌ | Deprecated — the compact/presentation dashboard-view toggle was removed; nothing reads or writes this key anymore. May still exist on older devices' localStorage; harmless if so. |
| `eshub:qa:config:v1` | Internal / QA harness | ❌ | Test/QA configuration injected by the E2E harness. Not cleared on logout; written only in non-production environments. |

---

## localStorage — deprecated (may still exist on older devices)

These keys are read once during the migration flow and then deleted.
Do not write to them; treat them as read-only migration sources.

| Key | Replaced by | Deprecated |
|---|---|---|
| `espace-devhub:ai-provider` | `user.prefs.aiProvider` (server, via `PATCH /auth/me`) | C7 / prefs migration |
| `espace-devhub:last-review-date` | `user.prefs.lastReviewDate` (server, via `PATCH /auth/me`) | C7 / prefs migration |
| `espace-devhub:grading` | `verdicts-store.js` (API: `GET/POST /api/v1/ai/grade-pr`) | pre-M7 |

Migration logic lives in `features/prefs/prefs-store.js` (for the two prefs keys)
and `features/grading/verdicts-store.js` (for grading).

---

## API-backed stores (no localStorage)

These stores keep their state in memory and on the server. They reset on
logout via the `auth:user-storage-cleared` event, not via `localStorage.removeItem`.

| Domain | API endpoint(s) | In-memory store | Notes |
|---|---|---|---|
| User session / auth | `GET /api/v1/auth/me`, `POST /api/v1/auth/login` | `features/auth/session-store.js` | Source of truth for the logged-in user. Bridged to prefs, hub configs, and other per-user stores. |
| User prefs | `PATCH /api/v1/auth/me { prefs }` | `features/prefs/prefs-store.js` | `aiProvider` + `lastReviewDate`. Optimistic writes with rollback. Legacy localStorage keys migrated up on first login. |
| Goals | `GET /api/v1/goals` | `features/goals/goals-store.js` | Canonical goal list. Loaded once per session; incremental updates via optimistic mutations. |
| Grading verdicts | `GET/POST /api/v1/ai/grade-pr` | `features/grading/verdicts-store.js` | Per-PR rubric verdicts. Hydrated from the API on mount; new verdicts POSTed as they stream in. |
| Hub configs | `GET /api/v1/hubs`, `POST/PATCH /api/v1/hubs/:id` | `features/hubs/` | Multi-hub (team) configurations. Server is the source of truth; in-memory SWR cache. |

---

## Clear-on-auth behaviour

`clearAllUserScopedStorage()` in `features/auth/clear-user-storage.js` fires at:

- Login (before hydrating the new session)
- Logout
- Signup
- Accept-invite
- TOTP verify

It removes every key in the **User-scoped ✅** rows above and dispatches
`auth:user-storage-cleared` so API-backed in-memory stores can also reset.

Device-local keys (`eshub:qa:config:v1`) are NOT cleared — they belong to
the device, not the user.
