# Deployment — Coolify

> Runbook for running the eSpace Dev Hub on the company's self-hosted
> **Coolify** instance. Replaces the old single-project Vercel deploy.

## Topology

Two application containers + one database, all in **one Coolify project**:

```
                    ┌─────────────────────────────────────────┐
   public domain →  │  web  (apps/web/Dockerfile, :3000)       │
                    │    next start                            │
                    │    /api/v1/* ──rewrite──► API_ORIGIN     │
                    └───────────────┬─────────────────────────┘
                                    │  Coolify internal network
                    ┌───────────────▼─────────────────────────┐
                    │  api  (apps/api/Dockerfile, :4000)       │
                    │    node dist/server.js                   │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │  mongo  (Coolify DB resource + volume)   │
                    └─────────────────────────────────────────┘
```

- **web** and **api** both point at the same git repo — different Dockerfiles.
- Unlike Vercel (API bundled in-process), the API is its own service here. The
  web tier forwards to it via `API_ORIGIN` (the `next.config.mjs` rewrite) and
  `INTERNAL_API_URL` (the server-side GitHub OAuth exchange fetch).

## Coolify resources

1. **MongoDB** — add a MongoDB database resource with a persistent volume. Note its
   **internal** connection string for `MONGO_URI`.
2. **api** — new Application → this git repo → **Dockerfile** = `apps/api/Dockerfile`,
   build context = repo root, port **4000**. Set the api env (below). Enable the
   healthcheck (`/healthz`).
3. **web** — new Application → same repo → **Dockerfile** = `apps/web/Dockerfile`,
   build context = repo root, port **3000**. Set the web build variables + runtime env
   (below). Attach the public domain here.

> Internal DNS: web reaches api at `http://<api-service-name>:4000`. Use the name
> Coolify assigns the api service. That value goes in both `API_ORIGIN` and
> `INTERNAL_API_URL` on the web app.

## Environment matrix

### web — build variables (inlined at build time by Next)
| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | public web origin, e.g. `https://devhub.espace.com.eg` |
| `NEXT_PUBLIC_AUTH_REQUIRED` | `true` / `false` |
| `NEXT_PUBLIC_JIRA_URL` | Atlassian workspace URL |
| `NEXT_PUBLIC_GITLAB_URL` | self-hosted GitLab URL |
| `NEXT_PUBLIC_JENKINS_URL` | Jenkins URL (if used) |
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | GitHub OAuth app client id |

> These must be **build** variables — Next bakes `NEXT_PUBLIC_*` into the client
> bundle at build time. Setting them only as runtime env has no effect.

### web — runtime env
| Var | Value |
|---|---|
| `API_ORIGIN` | `http://<api-service>:4000` |
| `INTERNAL_API_URL` | `http://<api-service>:4000` |
| `NEXT_PUBLIC_APP_URL` | public web origin (also read server-side in the OAuth route) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret (or `<ENGAGEMENT>_GITHUB_CLIENT_SECRET`) |

### api — runtime env
| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `CORS_ALLOWED_ORIGINS` | the public web origin (comma-separated if several) |
| `MONGO_URI` | Coolify Mongo internal connection string |
| `MONGO_DB_NAME` | e.g. `devhub` |
| `SESSION_SECRET` | **carry over unchanged from Vercel** (see migration) |
| `INTEGRATION_TOKEN_KEY` | **carry over unchanged from Vercel** (see migration) |
| `APP_URL` | public web origin (outbound email links) |
| `AI_PROVIDER` + provider keys | `ANTHROPIC_*`/`AWS_*` · `MISTRAL_*` · `GLM_*` · `OPENROUTER_*` |
| `RESEND_*` | email transport (`RESEND_API_KEY`, `RESEND_DOMAIN_MODE`, `RESEND_FROM_*`) |
| `LOG_LEVEL` | e.g. `info` |
| `<ENGAGEMENT>_GITHUB_CLIENT_ID` | per-engagement OAuth client ids |

Full reference: [`apps/api/.env.example`](../apps/api/.env.example),
[`apps/web/.env.example`](../apps/web/.env.example).

## MongoDB data migration (Atlas → Coolify)

> **Critical:** copy `SESSION_SECRET` and `INTEGRATION_TOKEN_KEY` from the current
> Vercel env into the Coolify **api** env **unchanged**. Integration tokens are
> envelope-encrypted at rest with `INTEGRATION_TOKEN_KEY`; a new key makes every
> stored token undecryptable and invalidates all sessions.

```bash
# 1. Dump from Atlas (source of truth today)
mongodump --uri "mongodb+srv://<atlas-uri>/<db>" --out ./dump

# 2. Restore into the Coolify Mongo. Run from a host that can reach the Mongo
#    resource (e.g. a temporary shell in the Coolify network, or expose it
#    briefly). --nsInclude/--drop as appropriate.
mongorestore --uri "mongodb://<coolify-mongo-internal>/" --drop ./dump
```

Verify after restore: an existing user can log in **and** a previously-saved
integration token still decrypts (proves both keys were carried correctly).

## GitHub OAuth

Update the GitHub OAuth app's **Authorization callback URL** to the new domain:
`{NEXT_PUBLIC_APP_URL}/oauth/github`.

## Cutover order

1. Deploy **Mongo** + restore data.
2. Deploy **api**; confirm its `/healthz` is green.
3. Deploy **web** (build vars + runtime env set); confirm `GET /api/healthz` on the
   web domain returns healthy (proves the rewrite reaches the api container).
4. Smoke test: login, Jira/GitLab/GitHub proxy calls, one AI goal-classify, a full
   GitHub OAuth round-trip on the new domain.
5. Point production DNS at Coolify.
6. Decommission the Vercel project.

## Local parity test (before pushing to Coolify)

The repo's compose file has a profile-gated `web` service that builds the same image
and wires it to the `api` container exactly like the split deploy:

```bash
docker compose --profile full up -d --build   # mongo + api + web
# → http://localhost:3000
```
