# syntax=docker/dockerfile:1.7
#
# eSpace Dev Hub API container.
#
# Two stages: build the TypeScript → JS once, then ship a slim runtime
# image that only carries what `node dist/server.js` actually needs.
#
# Why this exists
# ───────────────
# The deployed Vercel function bundles apps/api inside its serverless
# catch-all (apps/web/src/pages/api/v1/[...path].ts). For users on
# networks where Vercel can't reach the upstream (e.g. Crealogix's
# internal GitLab at git.bcn.crealogix.net), we run the SAME Express
# app as a standalone container — on a host that DOES have line of
# sight to the upstream — and point Vercel's `API_ORIGIN` env at it
# (next.config.mjs rewrites /api/v1/* to that origin).
#
# Build context is the REPO ROOT, not apps/api. The workspace dep
# `@espace-devhub/shared` lives one level up, so we copy the whole
# tree.

# ─── build stage ───────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /repo

# Manifests first → keeps the install layer cached when only sources
# change. We need the workspace topology to be visible to npm so
# `npm ci` can hoist correctly.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Install ONLY the api + shared subtree — NOT the apps/web frontend. The
# api image has no use for Next/React/GSAP/etc., and installing the whole
# monorepo tree spikes memory enough to OOM small build hosts (e.g. a
# modest Coolify server). `npm ci --workspace` does NOT reduce the
# install (ci always materialises the full lockfile), so instead we drop
# apps/web from the workspaces list and use `npm install` — which honours
# the reduced set. Dep versions still resolve from package-lock.json.
# ci would reject the package.json↔lock mismatch, hence install.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.workspaces=(p.workspaces||[]).filter(w=>w!=='apps/web');fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
    && npm install --omit=dev --no-audit --no-fund

# Copy only what the api build needs. We deliberately skip apps/web/src
# so editing the frontend doesn't bust the api image's cache.
COPY packages/shared packages/shared
COPY apps/api apps/api

# Compile TS → dist/. Same step the Vercel build runs. typescript is a
# regular (non-dev) dependency of apps/api, so it survived --omit=dev.
RUN npm run build --workspace=@espace-devhub/api

# No prune step needed — the install above was already --omit=dev, so the
# tree carries no devDependencies to trim.

# ─── runtime stage ─────────────────────────────────────────────────
FROM node:20-alpine

# `tini` becomes PID 1 so SIGTERM from `docker stop` reaches Node
# cleanly and Mongo connections drain instead of orphaning.
RUN apk add --no-cache tini wget

WORKDIR /repo

# Carry over node_modules + the built api + the shared package. We
# don't run `npm install` here — the build stage already produced a
# tree-shaken, dev-dep-free install. Copying preserves the workspace
# layout so the runtime resolves `@espace-devhub/shared` correctly.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages packages
COPY --from=build /repo/apps/api apps/api
COPY --from=build /repo/package.json /repo/package-lock.json ./

WORKDIR /repo/apps/api

# Non-root runtime is good hygiene — the `node` user comes with the
# official image and owns the /repo tree by default when we COPY.
USER node

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# Express exposes /healthz unconditionally (apps/api/src/modules/health
# /routes.ts). Wget is from `apk add` above. 30s interval, 5 retries —
# matches how Vercel's external health probe behaves.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:4000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
