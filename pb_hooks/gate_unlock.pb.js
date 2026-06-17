/// <reference path="../pb_data/types.d.ts" />

// ─── POST /api/sage/gate-unlock — free-membership signup endpoint ────────────
//
// Anonymous endpoint called directly from the browser by the signup-gate
// component on sage.is / sage.education. Creates (or refreshes) a subscribers
// record, mints a PocketBase auth token, and sets it as an HttpOnly cookie on
// Domain=.sage.is so every subdomain shares the unlock state.
//
// The read path on consumer sites is cookie-only — they don't call back to
// PocketBase on every page load. So a PocketBase outage at read time never
// blocks existing members. An outage at signup-write time returns 503
// "try again in a moment" because the membership record is the source of truth.
//
// Phase 2 will add a second route here for OAuth callback handling
// (/api/sage/gate-unlock/oauth/<provider>/callback) sharing the same upsert
// + cookie-mint helper.

routerAdd("POST", "/api/sage/gate-unlock", function (e) {
  // ─── Bind + validate the request body ───
  var data = new DynamicModel({ email: "", source: "" });
  e.bindBody(data);

  var email = String(data.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestError("Please enter a valid email address.");
  }

  var source = String(data.source || "").trim().substring(0, 100) || "sage.is";

  // ─── Upsert subscribers record ───
  var record;
  try {
    // Existing member — refresh unlocked_at and continue
    record = e.app.findFirstRecordByData("subscribers", "email", email);
    record.set("unlocked_at", new Date().toISOString());
    e.app.save(record);
  } catch (notFoundErr) {
    // New member — create
    try {
      var coll = e.app.findCollectionByNameOrId("subscribers");
      record = new Record(coll);
      record.set("email", email);
      record.set("source", source);
      record.set("tags", ["gate-unlock"]);
      record.set("unlocked_at", new Date().toISOString());
      record.set("verified", true);
      // Random password — never used (password auth is disabled on this collection)
      // but PocketBase's auth schema requires a value. Phase 3 enables passwords
      // and we'll prompt for one via a separate self-service flow.
      record.setPassword($security.randomString(40));
      e.app.save(record);
      console.log("New member: " + email + " (source=" + source + ")");
    } catch (createErr) {
      console.log("Subscriber create failed for " + email + ": " + createErr);
      throw new ApiError(503, "Try again in a moment.", null);
    }
  }

  // ─── Mint PocketBase-native auth token ───
  // HS256 JWT signed with the collection's tokenKey. Duration is set in the
  // 003_subscribers migration (authToken.duration = 365 days). Rotating
  // tokenKey on a record invalidates all of that member's tokens.
  var token = $tokens.newAuthRecordAuthToken(record);

  // ─── Determine cookie scope from request hostname ───
  // PocketBase is dual-hosted at pb.sage.is (for sage.is consumers) and
  // pb.sage.education (for sage.education consumers). Browsers only accept
  // Set-Cookie for the responding host's own registrable domain — pb.sage.is
  // CAN'T set a cookie on .sage.education and vice versa. So the cookie's
  // Domain attribute is picked from whichever hostname the client used.
  //
  // Unknown hosts get refused — defensive against misconfiguration or
  // someone pointing a third domain at the same IP.
  var host = String(e.request.host || "").toLowerCase();
  var cookieDomain;
  if (host === "pb.sage.is") {
    cookieDomain = ".sage.is";
  } else if (host === "pb.sage.education") {
    cookieDomain = ".sage.education";
  } else {
    console.log("Refusing gate-unlock from unknown host: " + host);
    throw new BadRequestError("Invalid host.");
  }

  // ─── Set membership cookies ───
  // Two cookies for defence-in-depth on the JWT itself:
  //   - sage_gate (HttpOnly): the JWT, not readable by JavaScript.
  //     XSS can't exfiltrate it; the attacker is confined to ambient session.
  //   - sage_gate_present: JS-readable sentinel so the gate component can
  //     locally decide "this user is unlocked, don't render the gate"
  //     without needing to call PocketBase on every page load.
  var maxAge = 31536000; // 365 days
  var cookieAttrs = "Domain=" + cookieDomain + "; Path=/; Max-Age=" + maxAge + "; Secure; SameSite=Lax";

  e.response.header().add(
    "Set-Cookie",
    "sage_gate=" + token + "; HttpOnly; " + cookieAttrs
  );
  e.response.header().add(
    "Set-Cookie",
    "sage_gate_present=1; " + cookieAttrs
  );

  return e.json(200, { ok: true });
});
