# syntax=docker/dockerfile:1.7
#
# eSpace Dev Hub WEB container (Next.js frontend).
#
# Companion to apps/api/Dockerfile. On Coolify we run web + api as two
# separate services: this image serves the Next.js app with `next start`,
# and forwards /api/v1/* to the standalone Express container via the
# `API_ORIGIN` rewrite in next.config.mjs. On Vercel the API used to be
# bundled in-process (the pages/api/v1 catch-all); here it's a separate
# service, so `API_ORIGIN` / `INTERNAL_API_URL` point at the api container.
#
# Why NOT `output: standalone`
# ────────────────────────────
# Next 16.1.x's Turbopack standalone tracing drops native/external deps
# (vercel/next.js#88844). The web build still compiles the bundled-API
# catch-all, which pulls in @node-rs/argon2 (native) + mongodb, so a
# traced standalone bundle can miss them at runtime. We instead ship a
# pruned-but-complete node_modules and run `next start` — bigger image,
# but reliable. Image size is a non-issue on an internal Coolify box.
#
# Build context is the REPO ROOT (like the api image): the workspace deps
# @espace-devhub/api + @espace-devhub/shared live one level up.

# ─── build stage ───────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /repo

# Manifests first → install layer stays cached when only sources change.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

RUN npm ci

# Sources. The web build (see apps/web/package.json "build") first compiles
# the api TS, then runs `next build`, so we need all three workspaces.
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they
# must be present as build args (Coolify: mark these as build variables).
# Anything server-only (API_ORIGIN, GITHUB_CLIENT_SECRET, …) is injected at
# RUN time and must NOT be baked here.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_AUTH_REQUIRED
ARG NEXT_PUBLIC_JIRA_URL
ARG NEXT_PUBLIC_GITLAB_URL
ARG NEXT_PUBLIC_JENKINS_URL
ARG NEXT_PUBLIC_GITHUB_CLIENT_ID
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_AUTH_REQUIRED=$NEXT_PUBLIC_AUTH_REQUIRED \
    NEXT_PUBLIC_JIRA_URL=$NEXT_PUBLIC_JIRA_URL \
    NEXT_PUBLIC_GITLAB_URL=$NEXT_PUBLIC_GITLAB_URL \
    NEXT_PUBLIC_JENKINS_URL=$NEXT_PUBLIC_JENKINS_URL \
    NEXT_PUBLIC_GITHUB_CLIENT_ID=$NEXT_PUBLIC_GITHUB_CLIENT_ID

RUN npm run build --workspace=@espace-devhub/web

# Drop dev deps to slim the runtime tree (tsx, pino-pretty, …). `next`,
# `typescript`, and tailwind are in `dependencies` so they survive.
RUN npm prune --omit=dev --workspaces

# ─── runtime stage ─────────────────────────────────────────────────
FROM node:20-alpine

# tini as PID 1 → SIGTERM from `docker stop` reaches Node cleanly.
RUN apk add --no-cache tini wget

WORKDIR /repo

# Workspace-preserving copy so `@espace-devhub/*` resolves at runtime.
# apps/web is chowned to `node` because `next start` writes to .next/cache.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages packages
COPY --from=build /repo/apps/api apps/api
COPY --from=build --chown=node:node /repo/apps/web apps/web
COPY --from=build /repo/package.json /repo/package-lock.json ./

USER node

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start", "--workspace=@espace-devhub/web"]
