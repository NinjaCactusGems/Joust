# Joust

Multiplayer web app, mobile-first. Currently an empty repository — architecture and stack are not yet decided.

## Hosting & Infrastructure

The app will be deployed to **Cloudflare**.

- **Domain:** `ninja-cactus.com` (registered through Cloudflare, managed in the same Cloudflare account).
- **Platform:** Cloudflare (Workers for compute; pick the right storage primitive per need — D1, KV, R2, Durable Objects).
- Mobile-first browser app. Native wrappers are out of scope unless explicitly added later.

## CI/CD

All CI/CD runs in GitHub Actions and deploys to Cloudflare.

Two **organisation secrets** are already configured and must be used by any workflow that talks to Cloudflare:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account ID. |
| `CLOUDFLARE_API_KEY` | API token scoped for Workers, DNS, R2, and related permissions. |

Notes for workflows:

- Reference them as `${{ secrets.CLOUDFLARE_ACCOUNT_ID }}` and `${{ secrets.CLOUDFLARE_API_KEY }}`.
- The secret is named `CLOUDFLARE_API_KEY` but holds an **API token** (not a Global API Key). When using `cloudflare/wrangler-action`, pass it as `apiToken:`. When calling the Cloudflare API directly, send it as `Authorization: Bearer $CLOUDFLARE_API_KEY`.
- Token scopes already granted: Workers, DNS, R2, and others. If a workflow needs a scope that isn't present, ask before rotating — don't silently swap in a Global API Key.
- Do **not** add per-repo duplicates of these secrets; rely on the organisation-level ones.
- Never echo the token, write it to logs, or commit it to the repo.

## Conventions

- Default branch: `main`.
- Deploy flow:
  - Push to `main` → `.github/workflows/deploy-prod.yml` deploys to `joust.ninja-cactus.com`.
  - Open / push to a PR → `.github/workflows/deploy-preview.yml` deploys a preview to `<branch>.joust.pages.dev` and posts the URL as a sticky comment.
  - All PRs and pushes to `main` also run `.github/workflows/ci.yml` (lint, typecheck, build).
- Keep infrastructure-as-code (wrangler.toml, workflow files) in the repo so deploys are reproducible. Cloudflare's Git integration is intentionally not used — the repo is the source of truth.
- See `README.md` for one-time setup (Pages project pre-creation, custom domain attach, token scope check).
