/// <reference path="../pb_data/types.d.ts" />

// ─── POST /api/sage/gate-unlock — free-membership signup endpoint ────────────
//
// Anonymous endpoint called directly from the browser by the signup-gate
// component on sage.is / sage.education. Creates (or refreshes) a subscribers
// record, mints a PocketBase auth token, and returns it in the JSON body.
//
// Architecture: token-in-body, not Set-Cookie. The consumer site stores the
// token in localStorage and the gate's read-path checks localStorage. PB's
// default `*` CORS is fine because the fetch does not use `credentials:
// include` — we never need per-origin Allow-Credentials. Works under any
// vendor with any number of consumer domains.
//
// Trade-off: a localStorage token is XSS-readable. Accepted here because the
// gate guards CONTENT, not payment or auth state. Revisit if Phase 3 adds
// payments or sensitive account actions — for those, run the endpoint behind
// a same-origin proxy and switch to HttpOnly cookies.
//
// ─── Two PocketBase v0.36 JSVM gotchas this file works around ──────────────
//
// 1. NO module-top `var` declarations. PB v0.36's Goja runtime silently
//    drops the entire module if you declare module-scope vars outside a
//    hook callback — the route registers but the handler never fires, and
//    every request returns the generic 400 with no log line. v0.3.5 hit
//    this. All version constants and counters live inside the handler.
//
// 2. NO `throw` for HTTP errors. PB v0.36's routerAdd recovery middleware
//    catches every thrown exception — including `new BadRequestError(…)` —
//    and rewrites it to "Something went wrong while processing your request."
//    400. Use `return e.json(status, body)` instead; that writes the
//    response directly without going through recovery.

routerAdd("POST", "/api/sage/gate-unlock", function (e) {
  // One-line breadcrumb per request. PB v0.36 doesn't log routerAdd hits,
  // so this is how we confirm the deploy + see what host PB sees behind
  // Cloudflare/CapRover-nginx.
  console.log("[gate-unlock v0.4.3] POST host=" + String(e.request.host || ""));

  // ─── Bind + validate the request body ───
  var data = new DynamicModel({ email: "", source: "" });
  try {
    e.bindBody(data);
  } catch (bindErr) {
    console.log("[gate-unlock] bindBody failed: " + bindErr);
    return e.json(400, { ok: false, message: "Invalid request body." });
  }

  var email = String(data.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return e.json(400, { ok: false, message: "Please enter a valid email address." });
  }

  var source = String(data.source || "").trim().substring(0, 100) || "unknown";

  // ─── Upsert subscribers record ───
  // findFirstRecordByData throws when the record doesn't exist — that's the
  // signal to create. Any other find failure (DB outage, schema issue) also
  // lands here and triggers a create attempt; if the create then fails with
  // "email already exists" we return 503 so the client can retry.
  var record;
  try {
    record = e.app.findFirstRecordByData("subscribers", "email", email);
    record.set("unlocked_at", new Date().toISOString());
    e.app.save(record);
  } catch (notFoundErr) {
    try {
      var coll = e.app.findCollectionByNameOrId("subscribers");
      record = new Record(coll);
      record.set("email", email);
      record.set("source", source);
      record.set("tags", ["gate-unlock"]);
      record.set("unlocked_at", new Date().toISOString());
      record.set("verified", true);
      // Random password placeholder — auth happens via the JWT minted
      // below, not via password. Phase 3 may enable passwords via a
      // separate self-service flow.
      record.setPassword($security.randomString(40));
      e.app.save(record);
      console.log("[gate-unlock] new member: " + email + " (source=" + source + ")");
    } catch (createErr) {
      console.log("[gate-unlock] subscriber create failed for " + email + ": " + createErr);
      return e.json(503, { ok: false, message: "Try again in a moment." });
    }
  }

  // ─── Mint PocketBase-native auth token ───
  // HS256 JWT signed with the collection's tokenKey. Duration is set in the
  // 003_subscribers migration (authToken.duration = 365 days). Rotating
  // tokenKey on a record invalidates all of that member's tokens.
  var token;
  try {
    token = record.newAuthToken();
  } catch (tokenErr) {
    console.log("[gate-unlock] token mint failed for " + email + ": " + tokenErr);
    return e.json(503, { ok: false, message: "Try again in a moment." });
  }

  return e.json(200, {
    ok: true,
    token: token,
    email: email,
  });
});
