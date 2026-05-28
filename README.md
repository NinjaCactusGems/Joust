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

There's a `Bootstrap Cloudflare` workflow that does steps 1 and 2 for you using the existing org secrets:

1. Open the repo's **Actions** tab → **Bootstrap Cloudflare** → **Run workflow** on `main`.
2. It creates the `joust` Pages project (with `main` as the production branch) and attaches `joust.ninja-cactus.com` as a custom domain. Both steps are idempotent — re-running is a no-op.
3. Once green, you can delete `.github/workflows/bootstrap.yml` or leave it in place.

### What it's doing under the hood

**1. Pages project** — creates a project named `joust` with `production_branch=main`. Manual equivalent:
```bash
export CLOUDFLARE_API_TOKEN=<api token>
export CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler pages project create joust --production-branch=main
```
If you skip this and let the first prod deploy auto-create, the production branch defaults to `production`, not `main` — preview and prod end up swapped.

**2. Custom domain** — POSTs to `/accounts/{id}/pages/projects/joust/domains` with `{"name":"joust.ninja-cactus.com"}`. Same operation as the dashboard's *Add custom domain* button. Because `ninja-cactus.com` is in the same Cloudflare account, the CNAME is auto-created in the existing zone and SSL provisions automatically. `joust.ninja-cactus.com` stays a subdomain of `ninja-cactus.com` — not a separate zone.

### 3. Verify API token scopes

The bootstrap workflow (and all deploys) needs:

- **Account → Cloudflare Pages → Edit**
- **Account → Account Settings → Read**

If either is missing, the workflow fails with a clear error in the logs. Add them to the existing token rather than rotating to a Global API Key.

## What's not here yet

- **Multiplayer.** Originally planned as PartyKit; as of 2025 PartyKit's primitives have been folded into Cloudflare's Agents SDK / Durable Objects. Re-evaluate the realtime layer when the client is ready for it.
- **Per-PR custom subdomains** (e.g. `pr-123.joust.ninja-cactus.com`). Previews live on `<branch>.joust.pages.dev` instead — no wildcard DNS needed.
