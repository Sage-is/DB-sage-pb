/// <reference path="../pb_data/types.d.ts" />

// ─── POST /api/sage/gate-unlock — free-membership signup endpoint ────────────
//
// Anonymous endpoint called directly from the browser by the signup-gate
// component on sage.is / sage.education. Creates (or refreshes) a subscribers
// record, mints a PocketBase auth token, and returns it in the JSON body.
//
// Architecture: token-in-body, not Set-Cookie. The consumer site stores the
// token in localStorage and the gate's read-path checks localStorage. This
// is intentionally simpler than the cookie + cross-origin CORS dance — it
// works under any vendor (Cloudflare, Pages, self-host) without needing
// per-origin ACAO + Allow-Credentials. PB's default `*` CORS is fine because
// we don't use credentialed fetch.
//
// Trade-off: a localStorage token is XSS-readable. We accept that here
// because the gate guards CONTENT, not payment or auth state. An attacker
// who already has XSS on the consumer site can read anything the page can —
// the gate token is not a meaningful escalation. If payments or sensitive
// account actions get added in Phase 3, revisit this with HttpOnly cookies
// behind a same-origin proxy.

var GATE_HOOK_VERSION = "0.4.0-token-in-body";
console.log("[gate-unlock] hook loaded v" + GATE_HOOK_VERSION);

routerAdd("POST", "/api/sage/gate-unlock", function (e) {
  // ─── Bind + validate the request body ───
  var data = new DynamicModel({ email: "", source: "" });
  try {
    e.bindBody(data);
  } catch (bindErr) {
    return e.badRequestError("Invalid request body.", null);
  }

  var email = String(data.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return e.badRequestError("Please enter a valid email address.", null);
  }

  var source = String(data.source || "").trim().substring(0, 100) || "sage.is";

  // Host tracked for analytics + abuse detection, but no longer used to
  // pick a cookie domain (we don't set cookies). Unknown hosts still get
  // rejected as a defensive measure.
  var host = String(e.request.host || "").toLowerCase();
  if (host !== "pb.sage.is" && host !== "pb.sage.education") {
    console.log("[gate-unlock] refusing unknown host: " + host);
    return e.badRequestError("Invalid host.", null);
  }

  // ─── Upsert subscribers record ───
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
      // Random password placeholder — auth happens via the JWT we mint
      // below, not via password. Phase 3 may enable passwords via a
      // separate self-service flow.
      record.setPassword($security.randomString(40));
      e.app.save(record);
      console.log("[gate-unlock] new member: " + email + " (source=" + source + ", host=" + host + ")");
    } catch (createErr) {
      console.log("[gate-unlock] subscriber create failed for " + email + ": " + createErr);
      return e.error(503, "Try again in a moment.", null);
    }
  }

  // ─── Mint PocketBase-native auth token ───
  // HS256 JWT signed with the collection's tokenKey. Duration is set in the
  // 003_subscribers migration (authToken.duration = 365 days). Rotating
  // tokenKey on a record invalidates all of that member's tokens.
  var token = record.newAuthToken();

  return e.json(200, {
    ok: true,
    token: token,
    email: email,
  });
});
