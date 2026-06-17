# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.1] — 2026-06-17

### Fixed

- **Membership gate broken on PB v0.36** — `$tokens.newAuthRecordAuthToken(record)` no longer exists in PocketBase v0.36; the `$tokens` JSVM namespace was removed. `POST /api/sage/gate-unlock` now calls `record.newAuthToken()` (a method on the Record itself, confirmed via `pb_data/types.d.ts`) to mint the membership JWT. Before this fix, valid email submissions hit an unhandled exception and PocketBase returned a generic `400 "Something went wrong"` instead of setting the cookie and unlocking the article.

---

## [0.3.0] — 2026-06-17

### Added

- **Membership gate endpoint** — anonymous `POST /api/sage/gate-unlock` creates or refreshes a `subscribers` record, mints a PocketBase auth token, and sets two cookies scoped to the registrable domain: HttpOnly `sage_gate` (JWT) and JS-readable `sage_gate_present` (sentinel). Host header determines cookie domain (`.sage.is` or `.sage.education`); unknown hosts are refused.
- **Subscribers collection** (`pb_migrations/003_subscribers.js`) — auth-type collection with 365-day tokens, anonymous create, admin-only read. Phase 1: password/OAuth/MFA/OTP disabled. Phase 2 will enable OAuth2.
- **CORS origins** — `--origins` flag added to both `Dockerfile` CMD and `captain-definition`, covering `sage.is`, `www.sage.is`, `sage.education`, `www.sage.education`.

### Fixed

- `captain-definition` was overriding the Dockerfile CMD at CapRover deploy time, silently making the `--origins` addition to the Dockerfile a no-op in production. Both are now kept in sync.

### Changed

- `.gitignore` / `.dockerignore` converted to deny-all-dotfiles + explicit re-include pattern, matching the canonical shape rolling out across the active workspace.

---

## [0.2.5] and earlier

See git log for history prior to this file.
