# TODO

## PocketBase Go Source Customization

- [ ] Fork PocketBase and add as a **git subtree** (not submodule — simpler for onboarding devs)
- [ ] Fix aggressive caching of admin UI static assets (`/_/images/*`) — PocketBase's Go embedded file server sets `Last-Modified`/`ETag` headers that cause `304 Not Modified` even after Cloudflare cache purge + browser clear. Options: add cache-busting hashes to asset URLs, override `Cache-Control` headers in Go source, or add Cloudflare page rule to force revalidation on `/_/*`
- [ ] Explore deeper admin UI modifications beyond logo (Svelte components in `ui/src/`)
- [ ] Set up CI to auto-rebase subtree when upstream PocketBase releases new versions

## CDN / Caching

- [ ] Set up Cloudflare Free in front of pb.sage.is
- [ ] Configure cache rules: bypass `/_/*` and `/api/*`, cache `pb_public/**` aggressively
- [ ] Benchmark `pb_public/` static file throughput

## Branding

- [ ] Replace placeholder traced logo SVG with proper vector version of sage.is hex-S mark
- [ ] Generate high-quality favicon PNGs from final vector logo
