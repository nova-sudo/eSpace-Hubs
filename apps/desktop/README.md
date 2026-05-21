# `@espace-devhub/desktop` — Companion app

Desktop tray app that runs the eSpace Dev Hub **backend container** on
a user's machine. The deployed Vercel frontend can then route API
calls through to it (via a Cloudflare Tunnel), giving the user access
to private resources their machine can reach but Vercel cannot — for
example, Crealogix's internal GitLab at `git.bcn.crealogix.net`.

## Phase 1 (this directory, today)

What works:

- ✅ Tray icon + window UI
- ✅ Start / stop the `docker compose --profile tunnel` stack
- ✅ Live API healthcheck against `localhost:4000/healthz`
- ✅ Persisted settings (repo path, Cloudflare Tunnel token, auto-start)
- ✅ Logs panel tailing the docker compose output

What's deferred:

- 🚧 FortiClient VPN automation (Phase 2)
- 🚧 Per-user Cloudflare Tunnel auto-provisioning (Phase 3)
- 🚧 Server-side per-user `API_ORIGIN` routing (Phase 3)
- 🚧 Code signing + auto-update (Phase 4)
- 🚧 First-run onboarding wizard (Phase 4)

## Dev quick start

This app is intentionally **NOT** part of the root npm workspaces —
Electron's ~300MB install would slow every web/api iteration on
Vercel. Install deps explicitly:

```bash
cd apps/desktop
npm install                              # one-time, pulls electron + electron-builder
npm run dev                              # Vite HMR + Electron, two-process dev
```

Vite serves the renderer on `:5173`; Electron loads that URL in dev
mode and watches for main-process rebuilds.

## Build an installer locally

```bash
cd apps/desktop
npm run dist                             # Windows NSIS .exe in dist-electron/
```

The build is **unsigned** in Phase 1. Windows Defender SmartScreen
will warn the user on first launch ("Unknown publisher" → More info
→ Run anyway). Code signing comes in Phase 4.

## How users will use it

1. Install Docker Desktop (one-time)
2. Install this companion app (one-time)
3. Clone the espace-devhub repo somewhere on disk
4. Open the companion, point it at the repo path, paste their CF
   tunnel token
5. Click **Start backend** — Docker boots `mongo` + `api` + a
   Cloudflare Tunnel sidecar
6. Open the Vercel-deployed app in their browser; the frontend routes
   API calls through the user's tunnel

Phase 2 collapses step 4's "paste tunnel token" into "click Sign in
to Cloudflare" + auto-provisions a tunnel.

Phase 3 collapses the "open the Vercel app and it just works" into
literally that — currently the user must also set `API_ORIGIN` on
Vercel manually; phase 3 makes the frontend look up the routing
target per-user from the API.
