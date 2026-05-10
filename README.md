# eSpace Dev Hub

A personal performance dashboard and evidence tracker for eSpace programmers.
Integrates Jira, self-hosted GitLab, and GitHub into a single bento-grid view so
you can:

- Watch your live delivery and code-quality metrics (PR rounds, cycle time, merges,
  review turnaround, SLA resolution times, ...)
- Gather evidence for your L0 / L1 / L2 performance reviews — snapshot history
  and exportable activity logs

## Stack

- Next.js 16 (App Router, Turbopack)
- Tailwind v4, Radix, Framer Motion, Recharts, SWR
- No backend database — tokens live in `localStorage`, Next.js API routes act
  as a thin CORS-proxy to Jira / GitLab / GitHub

## Getting started

```bash
cp .env.example .env.local   # fill in your eSpace URLs + OAuth client IDs
npm install
npm run dev
```

Then open http://localhost:3000 and go to **Settings** to connect your
integrations.

## Integrations

| Provider | Auth mode | Where the token lives |
|----------|-----------|-----------------------|
| Jira | Personal API token (user pastes) | `localStorage` |
| GitLab (self-hosted) | Personal Access Token (user pastes) | `localStorage` |
| GitHub | OAuth 2.0 (redirect flow) | `localStorage` |

All API calls are proxied through `/api/{jira,gitlab,github}/...` so the browser
never talks directly to the provider (avoids CORS issues on self-hosted GitLab
and Jira Cloud).

## Status

v0 scaffold. Tiles render placeholder data until you wire up each provider.
