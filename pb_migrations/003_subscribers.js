/// <reference path="../pb_data/types.d.ts" />

// ─── subscribers — the membership identity collection ───────────────────────
//
// Auth-type collection with password auth disabled. Records are created by the
// gate_unlock hook (pb_hooks/gate_unlock.pb.js). Auth tokens are minted via
// $tokens.newAuthRecordAuthToken() and set as HttpOnly cookies on .sage.is by
// that same hook.
//
// Phase 2 will enable PocketBase's native OAuth2 (Google, GitHub, Apple,
// Facebook) on this same collection — no schema migration needed; just flip
// `oauth2.enabled = true` in admin or in a follow-up migration.
//
// Phase 3 may enable OTP / magic-link for self-service sign-in.

migrate((app) => {
  var collection = new Collection({
    name: "subscribers",
    type: "auth",

    // Long-lived tokens to match the 365-day membership cookie.
    authToken: { duration: 31536000 },

    // Disabled in Phase 1; enabled in Phase 2 alongside OAuth providers.
    oauth2: { enabled: false },
    mfa: { enabled: false },
    otp: { enabled: false },

    // No password login — this is a membership identity, not an account-with-password.
    // identityFields stays ["email"] so future auth methods can resolve users by email.
    passwordAuth: { enabled: false, identityFields: ["email"] },

    // Auth collections auto-include: id, email, emailVisibility, verified,
    // tokenKey, password, created, updated. Custom fields below.
    fields: [
      {
        name: "source",
        type: "text",
        required: true,
        max: 100,
        // e.g., "sage.is", "sage.education", "sage.is-oauth-github" (Phase 2)
      },
      {
        name: "tags",
        type: "json",
        maxSize: 2000,
        // e.g., ["gate-unlock"], later ["gate-unlock","newsletter-opted-in"]
      },
      {
        name: "unlocked_at",
        type: "date",
        required: true,
      },
      {
        name: "notes",
        type: "text",
        required: false,
        max: 5000,
      },
    ],

    // API rules:
    //   create: anonymous allowed (the gate_unlock hook creates records)
    //   list/view/update/delete: admin only — email is PII
    createRule: "",
    listRule: null,
    viewRule: null,
    updateRule: null,
    deleteRule: null,
  });

  return app.save(collection);
}, (app) => {
  var collection = app.findCollectionByNameOrId("subscribers");
  return app.delete(collection);
});
