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

These steps run **once per Cloudflare account** when bootstrapping the project.

### 1. Pre-create the Pages project

```bash
export CLOUDFLARE_API_TOKEN=<the api token from CLOUDFLARE_API_KEY>
export CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler pages project create joust --production-branch=main
```

If you skip this, the first prod deploy will auto-create the project but with `production` as the production branch instead of `main` — preview/prod will be the wrong way around.

### 2. Attach the custom domain

In the Cloudflare dashboard:

1. Go to **Workers & Pages** → **joust** → **Custom domains**.
2. Click **Set up a custom domain** and enter `joust.ninja-cactus.com`.
3. Cloudflare auto-creates the CNAME in the `ninja-cactus.com` zone and provisions SSL. No manual DNS edit needed.

`joust.ninja-cactus.com` stays a subdomain of the existing `ninja-cactus.com` zone — not a separate zone.

### 3. Verify API token scopes

`wrangler pages deploy` requires:

- **Account → Cloudflare Pages → Edit**
- **Account → Account Settings → Read**

If either is missing, deploys fail with `Authentication error [code: 10000]`. Add them on the existing token rather than rotating to a Global API Key.

## What's not here yet

- **Multiplayer.** Originally planned as PartyKit; as of 2025 PartyKit's primitives have been folded into Cloudflare's Agents SDK / Durable Objects. Re-evaluate the realtime layer when the client is ready for it.
- **Per-PR custom subdomains** (e.g. `pr-123.joust.ninja-cactus.com`). Previews live on `<branch>.joust.pages.dev` instead — no wildcard DNS needed.
