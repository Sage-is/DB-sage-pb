# TODO

## PocketBase Go Source Customization

- [ ] Fork PocketBase and add as a **git subtree** (not submodule — simpler for onboarding devs)
- [ ] Add `Cache-Control` / `ETag` headers for admin UI static assets (`/_/images/*`) to prevent aggressive browser caching of old logos/favicons
- [ ] Explore deeper admin UI modifications beyond logo (Svelte components in `ui/src/`)
- [ ] Set up CI to auto-rebase subtree when upstream PocketBase releases new versions

## CDN / Caching

- [ ] Set up Cloudflare Free in front of pb.sage.is
- [ ] Configure cache rules: bypass `/_/*` and `/api/*`, cache `pb_public/**` aggressively
- [ ] Benchmark `pb_public/` static file throughput

## Branding

- [ ] Replace placeholder traced logo SVG with proper vector version of sage.is hex-S mark
- [ ] Generate high-quality favicon PNGs from final vector logo
