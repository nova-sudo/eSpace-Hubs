# Run the backend locally (Docker)

This is the runbook for running `apps/api` as a Docker container —
either purely local (talking to a local Mongo + your laptop's network)
or paired with a Cloudflare Tunnel so the Vercel frontend can reach
it over the public internet.

When you need this: the Vercel-bundled API can't reach private
upstreams that only resolve on a corporate VPN (e.g. an internal
GitLab like `git.bcn.crealogix.net`). Running the API on a host
that's already on that VPN solves the network gap. The frontend
stays on Vercel.

---

## TL;DR

```bash
# 1. Make sure apps/api/.env.local has MONGO_URI, SESSION_SECRET,
#    INTEGRATION_TOKEN_KEY, and the <ENGAGEMENT>_* keys you need.
cp apps/api/.env.example apps/api/.env.local   # if you don't have one yet, then fill it in

# 2. Boot Mongo + API
docker compose up -d

# 3. (Optional) expose the API publicly so Vercel can reach it
echo "TUNNEL_TOKEN=eyJhIjoi…" > .env
docker compose --profile tunnel up -d

# 4. Point Vercel at the tunnel
#    Vercel → Settings → Environment Variables → API_ORIGIN=<public-tunnel-host>
#    Vercel → Deployments → Redeploy
```

That's it. Visit `https://espace-hubs.vercel.app` (or whatever your
deploy domain is). Every `/api/v1/*` call now traverses Vercel →
Cloudflare Tunnel → your `api` container → upstreams visible from
your host.

---

## What the two services do

| Service | Always-on? | What it is |
|---|---|---|
| `mongo` | yes (default profile) | Local MongoDB 7. The api connects to it when `MONGO_URI` points at `mongodb://mongo:27017/devhub-dev`. Skip it (`docker compose stop mongo`) if you want the api to talk to Atlas instead. |
| `api` | yes (default profile) | The Express server (`apps/api/dist/server.js`) inside a Node 20 Alpine container. Reads `apps/api/.env.local`. Exposes `:4000` to localhost only. |
| `tunnel` | opt-in (`--profile tunnel`) | A `cloudflare/cloudflared` sidecar that opens an outbound tunnel to Cloudflare's edge. Provides a stable public hostname for the `api` without any inbound firewall changes. |

---

## Three setup shapes

### Shape A — pure local dev, no Vercel involvement

Use when: you just want to develop against `localhost:3000` (Next dev
server) and talk to your own API on `localhost:4000`.

```bash
docker compose up -d        # mongo + api both running
npm run dev:web             # Next.js dev server on :3000, proxies /api/v1/* to :4000
```

In `apps/web/.env.local`, omit `API_ORIGIN` — Next's rewrite falls
through to the bundled catch-all, which won't run because the dev
server's catch-all goes to `localhost:4000` via `next.config.mjs`.

### Shape B — Vercel frontend + your laptop's API (via tunnel)

Use when: you want to test against the public Vercel deploy but the
API needs to run on a host with line-of-sight to private upstreams
(your laptop on the corporate VPN).

```bash
# One-time CF setup (free personal account works)
cloudflared tunnel login
cloudflared tunnel create dev-espace-hub
cloudflared tunnel token dev-espace-hub      # copy the eyJhIjoi… token

# Write the token into .env (NOT apps/api/.env.local)
echo "TUNNEL_TOKEN=eyJhIjoi…" > .env

# Boot mongo + api + tunnel
docker compose --profile tunnel up -d

# CF dashboard → Zero Trust → Networks → Tunnels → dev-espace-hub →
# Public Hostnames → Add public hostname
#   Subdomain: dev-api
#   Domain:    <your-cf-zone>
#   Service:   http://api:4000     ← Docker's service-name DNS
# Save. Now https://dev-api.<your-cf-zone>.com forwards to the api.

# Vercel → Settings → Environment Variables
#   API_ORIGIN = https://dev-api.<your-cf-zone>.com
#   (Production scope)
# Vercel → Deployments → Redeploy

# Visit https://espace-hubs.vercel.app — all /api/v1/* now flows
# through your laptop's api.
```

When you stop the host machine, the tunnel + api both drop. That's
fine for dev / personal testing. For production, see Shape C.

### Shape C — production: persistent host inside Crealogix's network

Same compose file, different host:

```bash
# On a Linux VM inside Crealogix's network that can reach
# git.bcn.crealogix.net (or whatever private upstream you need):
git clone https://github.com/nova-sudo/eSpaceDev.git
cd eSpaceDev
# Copy production env values into apps/api/.env.local — same set of
# keys, but values pointing at the production Mongo (Atlas), the
# production engagement integrations, etc.
echo "TUNNEL_TOKEN=eyJhIjoi…" > .env    # production CF tunnel token

docker compose --profile tunnel up -d

# That's it — the VM runs the API forever. systemd / Watchtower can
# auto-restart the container on host reboot.
```

Operational extras you probably want on a real host:
- A systemd unit that runs `docker compose --profile tunnel up`
  on boot
- Log shipping (the container logs to stdout, so `docker logs` or
  any log driver works — `fluentd`, `journald`, etc.)
- Image-update automation: `watchtower` polls a registry and
  redeploys when you push a new build

---

## Common gotchas

### "Can't connect to MongoDB" inside the container

If your `MONGO_URI` is `mongodb://localhost:27017/...`, that resolves
to the container's OWN localhost (which has no Mongo). Change it to
`mongodb://mongo:27017/devhub-dev` so Docker's service-name DNS
points at the `mongo` container.

If you're using Atlas, paste the Atlas SRV URI as-is — it's public
DNS, works the same inside the container as outside.

### "Cannot reach git.bcn.crealogix.net from inside the container"

The container shares the host's network via the default bridge
driver — but some VPN clients (Cisco AnyConnect, GlobalProtect)
don't push routes into the bridge. If the api inside Docker can't
reach an upstream that the host CAN reach, edit
`docker-compose.yml`:

```yaml
api:
  network_mode: "host"    # uncomment this; remove `ports:` (no needed)
```

This makes the container share the host's loopback + interfaces
directly, so VPN routes apply unchanged.

### Tunnel won't start: "TUNNEL_TOKEN required"

You activated `--profile tunnel` without setting the env. Either:
- Add `TUNNEL_TOKEN=…` to a `.env` file in the repo root, or
- Inline: `TUNNEL_TOKEN=… docker compose --profile tunnel up -d`

### "Build is slow / fails after editing apps/web"

The Dockerfile only copies `apps/api/` and `packages/shared/` so
editing the frontend should NOT bust the api image cache. If you're
seeing slow rebuilds, double-check that `.dockerignore` excludes
`apps/web/.next` and `apps/web/node_modules`.

---

## When to stop using this

If/when Crealogix IT exposes their internal GitLab via a public
hostname (or whitelists Vercel's egress IP via Pro Secure Compute),
you can revert to the Vercel-bundled API by un-setting `API_ORIGIN`
on Vercel. The serverless catch-all takes over again; this whole
runbook becomes optional.
