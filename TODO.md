# TODO

## Membership Gate (Phase 1)

- [ ] **Time-Delayed Membership Gate — PocketBase work**: dual-host the PB instance and version-control CORS. Plan at [`~/.claude/plans/are-you-able-to-twinkly-pike.md`](~/.claude/plans/are-you-able-to-twinkly-pike.md) (original: [`~/.claude/plans/a-growing-number-of-jiggly-cherny.md`](~/.claude/plans/a-growing-number-of-jiggly-cherny.md)). Backend hook + migration already shipped (`pb_hooks/gate_unlock.pb.js`, `pb_migrations/003_subscribers.js`).
  - [x] Version-control CORS origins via the Dockerfile `--origins` flag — PB v0.36 only exposes origins on the `serve` command, not via `app.settings()`. Updated `Dockerfile` CMD line; `pb.sage.is` rebuild + redeploy applies it. New consumer sites get a new entry in that CMD line.
  - [ ] **[MANUALLY]** Add DNS A record `pb.sage.education` → PocketBase VPS IP.
  - [ ] **[MANUALLY]** In CapRover dashboard, add `pb.sage.education` as an additional domain on the PocketBase app. Confirm Let's Encrypt provisions a cert.
  - [ ] **[WE]** Smoke-test the gate-unlock hook against both hosts: cookies set on the correct registrable domain; one `subscribers` record per email regardless of which host was used.

## Hardware Orders (Phase 1)

- [ ] Fix local PB migration syntax (presentable field + Field constructor issues in PB v0.36)
- [ ] Deploy hooks to cluster (order number generator + Resend email notifications)
- [ ] Order numbers: phone-style L-XXX-XXX-XXXX with random area codes from worldwide pool
- [ ] Two emails per order: team notification to join.us@sage.is + branded customer confirmation
- [ ] Test Resend integration end-to-end on production
- [ ] Add /hardware/ to sage.is site navigation once checkout flow confirmed

## Hardware Orders (Phase 2)

- [ ] Migrate to Django + Django Ninja (admin panel for order management)
- [ ] Stripe integration for Local/Hybrid hardware orders
- [ ] Lemon Squeezy integration for Cloud Managed orders (digital only, MoR handles VAT)
- [ ] Both settle to Mercury (US) or Portuguese bank
- [ ] Replace "Request a Quote" with direct checkout

## PocketBase Go Source Customization

- [ ] Fork PocketBase and add as a **git subtree** (not submodule — simpler for onboarding devs)
- [ ] Fix aggressive caching of admin UI static assets (`/_/images/*`) — PocketBase's Go embedded file server sets `Last-Modified`/`ETag` headers that cause `304 Not Modified` even after Cloudflare cache purge + browser clear. Options: add cache-busting hashes to asset URLs, override `Cache-Control` headers in Go source, or add Cloudflare page rule to force revalidation on `/_/*`
- [ ] Explore deeper admin UI modifications beyond logo (Svelte components in `ui/src/`)
- [ ] Set up CI to auto-rebase subtree when upstream PocketBase releases new versions

## CDN / Caching

- [ ] Set up Cloudflare Free in front of pb.sage.is
- [ ] Configure cache rules: bypass `/_/*` and `/api/*`, cache `pb_public/**` aggressively
- [ ] Benchmark `pb_public/` static file throughput
- [ ] Evaluate PB as a static host replacement (see Static Hosting section in README)
  - [ ] Test: deploy an Eleventy build output into `pb_public/` and measure response times
  - [ ] Compare against Cloudflare Pages for the same content
  - [ ] Test SPA routing via `--indexFallback`
  - [ ] Document max concurrent connections and throughput on CapRover instance
  - [ ] If viable, consider hosting smaller Sage sites (docs, landing pages) directly from PB

## Branding

- [ ] Replace placeholder traced logo SVG with proper vector version of sage.is hex-S mark
- [ ] Generate high-quality favicon PNGs from final vector logo
