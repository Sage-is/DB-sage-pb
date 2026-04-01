# Sage PocketBase

## v0.1.0

Generic, reusable PocketBase Docker image published to GHCR. Each project layers its own hooks, migrations, and public assets on top via CapRover's `captain-definition`.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Dockerfile (3-stage build from source)     │
│  1. node:20-alpine — build UI with branding │    Built from PocketBase source
│  2. golang:1.25    — compile Go binary      │    with Sage.is logo + favicons
│  3. alpine:3.21    — runtime (~15 MB)       │  → ghcr.io/sage-is/db-sage-pb:latest
└─────────────────────────────────────────────┘
                    │ FROM
┌───────────────────▼─────────────────────────┐
│  captain-definition                         │  → CapRover deploy (project-specific)
│  dockerfileLines:                           │
│    COPY pb_hooks/ pb_migrations/ pb_public/ │     hooks, migrations, public assets
└─────────────────────────────────────────────┘
```

The generic image is built from PocketBase source with Sage.is branding (logo, favicons). It contains no application code. Projects customize by adding:

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

### Testing

The test harness automates superuser creation, authentication, and order submission:

```bash
make test_fresh   # fresh volume — wipes DB, creates superuser, submits test order, keeps running
make test         # reuse existing volume — same flow, preserves existing data
```

Both leave the container running so you can inspect the admin UI at `http://localhost:8090/_/`. The script writes test credentials to `.env`:

```
PB_ADMIN_EMAIL = "admin@test.local"
PB_ADMIN_PASS = "testpass123"
```

**First-run note:** PocketBase v0.36 requires a superuser before migrations run and the API becomes usable. The test script handles this automatically. If running `docker compose up` manually, create the superuser first:

```bash
docker exec <container> pocketbase superuser upsert admin@test.local testpass123 --dir=/app/pb_data
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | No | Resend API key for order notification emails. If unset, orders are saved but no emails are sent. |

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

## Writing Hooks (JSVM Constraints)

PocketBase hooks run in a **Goja-based Go JS engine**, not Node.js. Key differences:

- **No `require()` or `import`** — no npm packages, only PocketBase built-in globals (`$http`, `$security`, `$os`, `$app`, etc.)
- **No async/await or Promises** — `$http.send()` is synchronous
- **Top-level functions are NOT visible inside hook callbacks.** This is the biggest gotcha. Define helper functions *inside* the callback, not at file scope:

```javascript
// BROKEN — generateOrderNumber is undefined inside the callback
function generateOrderNumber() { return "X-000"; }
onRecordCreateRequest(function(e) {
  e.record.set("order_number", generateOrderNumber()); // ReferenceError!
  e.next();
}, "orders");

// WORKS — everything inside the callback
onRecordCreateRequest(function(e) {
  function generateOrderNumber() { return "X-000"; }
  e.record.set("order_number", generateOrderNumber());
  e.next();
}, "orders");
```

- **Top-level `var` declarations** (e.g. config arrays) have the same issue — define them inside callbacks
- **String concatenation over template literals** — backticks work in some cases but `\${}` escaping is unreliable in Goja. Use `'...' + var + '...'` for HTML builders
- **Available hooks:** `onRecordCreateRequest` (before save, call `e.next()`), `onRecordAfterCreateSuccess` (after save, no `e.next()` needed), and [many more](https://pocketbase.io/docs/js-overview/)
- **Type definitions** are in `pb_data/types.d.ts` — auto-generated by PocketBase, useful for IDE autocomplete

## Current Project: Hardware Orders

This repo's hooks and migrations implement the **Sage Hardware Order Backend** for [sage.is/hardware](https://sage.is/hardware/).

**Order flow:**
1. User configures hardware at sage.is/hardware
2. Frontend POSTs to `/api/collections/orders/records` (falls back to mailto:join.us@sage.is if PB unreachable)
3. PocketBase saves the order with a phone-style order number (L-XXX-XXX-XXXX)
4. Resend sends two emails: team notification to join.us@sage.is + branded customer confirmation with config summary
5. Team reviews in PocketBase admin, follows up with PO/contract

### Orders API (for frontend developers)

**Base URL:** `https://pb.sage.is` (production) or `http://localhost:8090` (local)

#### Create an order

```
POST /api/collections/orders/records
Content-Type: application/json
```

No authentication required. The server auto-generates `order_number` — do not send it.

```json
{
  "email": "customer@example.com",
  "name": "Jane Smith",
  "organization": "Acme Corp",
  "config": {
    "deploy": "local",
    "platform": "AMD Ryzen 9",
    "compute": "16 cores",
    "memory": "128 GB DDR5",
    "storage": "2 TB NVMe",
    "software": "pro",
    "support": "priority",
    "access": { "ssh": true, "vpn": false, "web": true }
  },
  "monthly_total": 299,
  "annual_total": 3050,
  "status": "new"
}
```

**Response** (201 Created):

```json
{
  "id": "abc123...",
  "order_number": "V-310-560-7882",
  "email": "customer@example.com",
  "name": "Jane Smith",
  ...
}
```

The `order_number` is returned in the response — display it to the customer as their reference.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | email | yes | Customer email, receives confirmation |
| `name` | text | yes | 1–200 chars |
| `organization` | text | no | Max 200 chars |
| `config` | json | yes | Hardware configuration (max 50 KB) |
| `monthly_total` | number | yes | >= 0 |
| `annual_total` | number | yes | >= 0 |
| `status` | select | yes | Always send `"new"` |

**What happens server-side:**
- Order number is generated automatically (phone-style: `L-XXX-XXX-XXXX`)
- Team notification email sent to `join.us@sage.is` with full config + pricing
- Customer confirmation email sent to the provided `email` with config summary (no pricing)
- If `RESEND_API_KEY` is not configured, emails are silently skipped — the order is still saved

**Error handling for frontends:**
- On success (201): show the `order_number` to the customer
- On failure (4xx/5xx or network error): fall back to `mailto:join.us@sage.is` with the config pre-filled

#### Need changes to the schema, hooks, or API rules?

This repo is the source of truth for everything running at pb.sage.is. If your project needs:

- **New fields** on the orders collection (or a new collection entirely) — add a migration in `pb_migrations/`
- **New hooks** (webhooks, Slack notifications, validation logic) — add to `pb_hooks/main.pb.js`
- **Different API rules** (e.g. letting authenticated users list their own orders) — update the collection rules in a migration

Open a PR against this repo's `develop` branch. The hooks and migrations are deployed to pb.sage.is via CapRover on merge to `master`.

For quick questions or requests, reach out at `join.us@sage.is` or open an issue.

#### Other endpoints (auth required)

List, view, update, and delete operations require a valid superuser or auth token via the `Authorization: Bearer <token>` header.

```bash
# Authenticate (get a token)
curl -X POST https://pb.sage.is/api/collections/_superusers/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity": "you@sage.is", "password": "..."}'

# List orders
curl https://pb.sage.is/api/collections/orders/records \
  -H "Authorization: Bearer <token>"

# View a single order
curl https://pb.sage.is/api/collections/orders/records/<id> \
  -H "Authorization: Bearer <token>"

# Update order status
curl -X PATCH https://pb.sage.is/api/collections/orders/records/<id> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "contacted"}'
```

Full PocketBase API docs: [pocketbase.io/docs/api-records](https://pocketbase.io/docs/api-records/)

## Roadmap

**Phase 1 (live now):** PocketBase at pb.sage.is (Docker/CapRover) + contractual POs. Mailto fallback to join.us@sage.is. CTA says "Request a Quote".

**Phase 1 remaining:**
- Fix local PB migration syntax (presentable field + Field constructor issues in PB v0.36)
- Deploy hooks to cluster (order number generator + Resend email notifications)
- Test Resend integration end-to-end on production
- Add /hardware/ to site navigation once checkout flow is confirmed working

**Phase 2:** Django + Django Ninja replaces PocketBase (admin panel for order management). Stripe for Local/Hybrid hardware orders. Lemon Squeezy for Cloud Managed orders only (digital service, MoR handles VAT). Both settle to Mercury (US) or Portuguese bank. Paddle and Gumroad are not options — both prohibit physical goods.

## Branding & Customization

The PocketBase admin UI (`/_/`) is a Svelte/Vite app embedded in the binary. This image builds PocketBase **from source** with custom Sage.is branding baked in.

**What's customized:**
- Admin UI logo (`/_/images/logo.svg`) — Sage.is branded
- Favicons — custom sage leaf icons in all sizes
- Source: `branding/` directory in this repo

**To change the branding:**
1. Replace files in `branding/logo.svg` and `branding/favicon/`
2. Rebuild: `make it_build`
3. The Dockerfile clones PocketBase source, swaps in your branding, and builds from scratch

**Other customization:**
- `pb_public/` serves a fully custom public-facing UI (everything except `/_/`)
- Custom API routes via hooks in `pb_hooks/`
- CDN/reverse proxy in front for caching and headers

**Future options:**
- **Nginx rewrite layer** — add nginx reverse proxy for URL rewrites, custom headers, and response body rewriting to inject custom CSS into the admin UI
- **Full admin UI modifications** — beyond the logo, modify Svelte components in PocketBase's `ui/src/` directory for deeper customization
- **Performance benchmarking** — document `pb_public/` throughput characteristics for static hosting use cases
