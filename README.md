# Joust

Mobile-first multiplayer web app, deployed to Cloudflare Pages at **[joust.ninja-cactus.com](https://joust.ninja-cactus.com)**.

The multiplayer layer is deferred — this is currently a React + Tailwind client scaffold only.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS v4 (CSS-first config — no `tailwind.config.js`)
- Cloudflare Pages
- GitHub Actions CI/CD

## Develop

```bash
nvm use            # Node 20 from .nvmrc
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # tsc -b && vite build
npm run preview    # serve the production build locally
npm run typecheck
npm run lint
```

To test the mobile layout on a real device, run `npm run dev -- --host` and open your machine's LAN IP from the phone.

## Deploy

CI/CD is driven entirely from this repo — Cloudflare's Git integration is **not** used.

| Event | Workflow | Result |
| --- | --- | --- |
| Open / push to PR | `.github/workflows/deploy-preview.yml` | Deploys to `<branch>.joust.pages.dev`. The URL is posted as a sticky comment on the PR. |
| Push to `main` | `.github/workflows/deploy-prod.yml` | Deploys to production (`joust.ninja-cactus.com`). |
| Any PR / push to `main` | `.github/workflows/ci.yml` | Runs lint, typecheck, and build. No Cloudflare access. |

All Cloudflare workflows use the org-level secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_KEY` (see `CLAUDE.md`). The secret holds an API token and is passed as `apiToken:` to `cloudflare/wrangler-action`.

## One-time setup

There's a `Bootstrap Cloudflare` workflow that wires up the account-level setup using the existing org secrets:

1. Open the repo's **Actions** tab → **Bootstrap Cloudflare** → **Run workflow** on `main`.
2. It creates the `joust` Pages project (with `main` as the production branch), attaches `joust.ninja-cactus.com` as a custom domain, creates the matching CNAME, and ensures the account has a workers.dev subdomain so the party worker can deploy. Every step is idempotent — re-running is a no-op once everything is in place.
3. Once green, you can delete `.github/workflows/bootstrap.yml` or leave it in place.

### What it's doing under the hood

**1. Pages project** — creates a project named `joust` with `production_branch=main`. Manual equivalent:
```bash
export CLOUDFLARE_API_TOKEN=<api token>
export CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler pages project create joust --production-branch=main
```
If you skip this and let the first prod deploy auto-create, the production branch defaults to `production`, not `main` — preview and prod end up swapped.

**2. Custom domain** — POSTs to `/accounts/{id}/pages/projects/joust/domains` with `{"name":"joust.ninja-cactus.com"}`. Registers the domain with the Pages project and triggers SSL provisioning.

**3. CNAME record** — POSTs to `/zones/{zone_id}/dns_records` to create `joust.ninja-cactus.com` → `joust.pages.dev` (proxied) in the `ninja-cactus.com` zone. Only the Cloudflare dashboard's *Add custom domain* button auto-creates DNS; the API in step 2 does not, so this step is required.

`joust.ninja-cactus.com` stays a subdomain of the existing `ninja-cactus.com` zone — not a separate zone.

**4. Workers subdomain** — PUTs `/accounts/{id}/workers/subdomain` with `{"subdomain": "ninja-cactus"}`. A Cloudflare account has at most one workers.dev subdomain; every worker on the account is served from it as `<worker>.<subdomain>.workers.dev`. A fresh account doesn't get one automatically — without it, `wrangler deploy` of the party worker fails with API error 10063 (*"You need a workers.dev subdomain"*). Bootstrap tries `ninja-cactus` first and falls back to `ninja-cactus-<account-id-prefix>` if the preferred name is taken globally. The workflow output prints the resulting URL for the party worker.

### 3. Verify API token scopes

The bootstrap workflow (and all deploys) needs:

- **Account → Cloudflare Pages → Edit**
- **Account → Account Settings → Read**
- **Account → Workers Scripts → Edit** (for the party worker + workers.dev subdomain)
- **Zone → DNS → Edit** (for `ninja-cactus.com`)

If any is missing, the workflow fails with a clear error in the logs naming the missing scope. Add them to the existing token rather than rotating to a Global API Key.

## Multiplayer

The realtime layer is a separate Cloudflare Worker in [`party/`](./party), built on [`partyserver`](https://github.com/cloudflare/partykit) + Durable Objects (the Cloudflare-native successor to PartyKit). The client connects over WebSocket via [`partysocket`](https://github.com/cloudflare/partykit/tree/main/packages/partysocket).

### Local dev

Run two terminals:

```bash
npm run dev:party   # worker on http://localhost:1999
npm run dev         # Vite on http://localhost:5173
```

The client defaults to `localhost:1999` when `VITE_PARTY_HOST` is unset.

### Deploy

| Event | Effect |
| --- | --- |
| Push to `main` | Deploys the worker (`joust-party`) **then** rebuilds and deploys the Pages site. |
| Open / push PR | Rebuilds and deploys the Pages preview. Previews share the prod worker — no per-PR isolation. |

### How the build finds the worker

The deploy workflows query Cloudflare's API for the account's workers.dev subdomain and bake `VITE_PARTY_HOST=joust-party.<subdomain>.workers.dev` into the client at build time. There's nothing to configure manually.

If you ever move the worker to a custom domain (e.g. `party.joust.ninja-cactus.com`), set a repository variable named `PARTY_HOST` to that bare hostname (Settings → Secrets and variables → Actions → Variables). When present, it overrides the auto-derived value in both prod and preview builds.

## What's not here yet

- **Game logic.** The lobby shows presence (connected players) only — no turns, scoring, or chat yet.
- **Per-PR isolated party workers.** All previews share the prod worker.
- **Custom domain for the party worker** (e.g. `party.joust.ninja-cactus.com`). Workers.dev URL is fine for now.
- **Per-PR custom subdomains** (e.g. `pr-123.joust.ninja-cactus.com`). Previews live on `<branch>.joust.pages.dev` instead — no wildcard DNS needed.
