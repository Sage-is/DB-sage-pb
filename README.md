# Sage PocketBase

## v0.1.0

Generic, reusable PocketBase Docker image published to GHCR. Each project layers its own hooks, migrations, and public assets on top via CapRover's `captain-definition`.

## Architecture

```
┌──────────────────────────────┐
│  Dockerfile (generic)        │  → ghcr.io/sage-is/db-sage-pb:latest
│  Alpine + PocketBase binary  │     reusable by any project
└──────────────────────────────┘
               │ FROM
┌──────────────▼───────────────┐
│  captain-definition          │  → CapRover deploy (project-specific)
│  dockerfileLines:            │
│    COPY pb_hooks/            │     hooks, migrations, public assets
│    COPY pb_migrations/       │
│    COPY pb_public/           │
└──────────────────────────────┘
```

The generic image contains only PocketBase on Alpine — no application code. Projects customize by adding:

- `pb_hooks/` — JavaScript business logic (webhooks, email notifications, custom API routes)
- `pb_migrations/` — Collection schemas and seed data
- `pb_public/` — Static files served at the root URL (landing pages, SPAs, assets)

## Quick Start

### Local Development (binary)

```bash
# Download PocketBase for your platform from https://pocketbase.io/docs/
./pocketbase serve
```

Admin dashboard: `http://127.0.0.1:8090/_/`

### Local Development (Docker)

```bash
# Using docker-compose (bind-mounts hooks/migrations/public for live editing)
docker compose up

# Or using Make (builds generic image, bind-mounts project files)
make it_build
make it_run_dev
```

### Production (CapRover)

```bash
make it_deploy    # deploys via captain-definition
```

CapRover builds a thin layer on top of the GHCR image, copying in this project's hooks/migrations/public. Configure in CapRover app settings:
- **Persistent directory:** `/app/pb_data`
- **Environment variable:** `RESEND_API_KEY`
- **Application URL:** `https://pb.sage.is`

## Static Site Hosting

PocketBase can serve static files via `pb_public/`, making it a lightweight alternative to Netlify, Cloudflare Pages, or Vercel for self-hosted projects.

Drop files in `pb_public/` and they're served at the root URL. SPA routing is supported via `--indexFallback` (enabled by default) — missing paths fall back to `index.html`.

**Trade-offs vs dedicated static hosts:**
- No built-in CDN (add one in front — see below)
- Zero vendor lock-in, fully self-hosted
- API + static files in one binary — no separate hosting needed
- Efficient Go HTTP server, suitable for low-to-medium traffic

## CDN Options

PocketBase doesn't include a CDN, but you can add one in front:

| Option | Cost | Features | Best For |
|--------|------|----------|----------|
| **Cloudflare Free** | Free | DDoS protection, global caching, auto SSL, SSE support | Default recommendation |
| **CapRover nginx** | Free | Configure `proxy_cache` in nginx config | Zero external dependencies |
| **BunnyCDN / KeyCDN** | ~$0.50/mo | Pull CDN, global edge locations | Static asset distribution |
| **AWS CloudFront** | Free tier | 1TB/mo transfer, 10M requests/mo | AWS ecosystem projects |

**Cloudflare Free** is the recommended default — it provides unmetered DDoS protection, global caching, automatic SSL, and handles PocketBase's SSE realtime connections natively.

### Caching Strategy

When placing a CDN or cache in front of PocketBase:

| Route | Cache? | TTL | Notes |
|-------|--------|-----|-------|
| `pb_public/**` | Yes | 1 year | Static assets, set long Expires header |
| `GET /api/**` | Optional | 5-60min | Only for read-heavy, rarely-changing data |
| `POST /api/**` | No | — | Mutations must always reach origin |
| `/_/**` | No | — | Admin UI, bypass cache |
| `/api/realtime` | No | — | SSE connections, must not be cached |

**Note:** PocketBase uses Server-Sent Events (SSE) for realtime, not WebSocket. Both Cloudflare and nginx handle SSE natively.

## CI/CD

### Building and Publishing

```bash
make it_build                        # build generic image locally
make it_build_multi_arch_push_GHCR   # build amd64+arm64, push to GHCR
```

### Releasing

```bash
make first_release                   # initial v0.0.1 (one-time)
make patch_release                   # v0.0.1 → v0.0.2
make minor_release                   # v0.0.x → v0.1.0
make major_release                   # v0.x.x → v1.0.0
make release_and_push_GHCR           # finish release + push to GHCR
```

Uses git-flow branching: `develop` → `release/x.y.z` → `master` + tag.

## Current Project: Hardware Orders

This repo's hooks and migrations implement the **Sage Hardware Order Backend** for [sage.is/hardware](https://sage.is/hardware/).

**Order flow:**
1. User configures hardware at sage.is/hardware
2. Frontend POSTs to `/api/collections/orders/records`
3. PocketBase saves the order, emails team via Resend
4. Team reviews in PocketBase admin, follows up with PO/contract

**Environment variables:**
- `RESEND_API_KEY` — Resend API key for email notifications (optional, skips email if unset)

## Theming & Customization Roadmap

The PocketBase admin UI (`/_/`) is a Svelte/Vite app embedded in the binary. It **cannot be themed** without rebuilding PocketBase from source.

**What works today:**
- `pb_public/` serves a fully custom public-facing UI (everything except `/_/`)
- Custom API routes via hooks in `pb_hooks/`
- CDN/reverse proxy in front for caching and headers

**Future options:**
- **Nginx rewrite layer** — add nginx reverse proxy for URL rewrites, custom headers, and response body rewriting to inject custom CSS/branding into the admin UI
- **Custom PocketBase binary** — fork PocketBase, modify the admin UI source in `/ui` (Svelte/Vite), rebuild the binary with branding changes baked in
- **Performance benchmarking** — document `pb_public/` throughput characteristics for static hosting use cases
