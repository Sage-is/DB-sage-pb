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

var GATE_HOOK_VERSION = "0.4.2-no-throw";
var GATE_LOG_FIRED = false;

// Why no `throw` anywhere in this handler:
// PocketBase v0.36's routerAdd recovery middleware catches any thrown
// exception (including `new BadRequestError("…")` and `new ApiError(…)`)
// and converts it to a generic 400 "Something went wrong while processing
// your request." — the explicit message never reaches the client. (See
// main.pb.js's spam-guard comment which acknowledges this for event hooks
// too.) `return e.json(status, body)` writes the response directly without
// going through the recovery path, so the message survives. Every error
// path below uses it; the try/catch blocks exist only to TRANSLATE thrown
// JS errors (parse failures, PB SDK errors) into explicit JSON responses.
routerAdd("POST", "/api/sage/gate-unlock", function (e) {
  // One-shot deploy canary inside the handler. console.log at module-top
  // would throw at hooks-load time in PB v0.36 JSVM and silently drop the
  // entire module (that's what 404'd v0.3.4). Inside the handler it's safe.
  if (!GATE_LOG_FIRED) {
    GATE_LOG_FIRED = true;
    console.log("[gate-unlock] hook v" + GATE_HOOK_VERSION + " — first request received");
  }
  console.log("[gate-unlock] request from host=" + String(e.request.host || ""));

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

  var source = String(data.source || "").trim().substring(0, 100) || "sage.is";

  // ─── Upsert subscribers record ───
  // findFirstRecordByData throws when the record doesn't exist — that's the
  // signal to create. Any OTHER error during find (DB outage, schema issue)
  // would also land in the catch and trigger a create attempt; if the
  // create then errors with "email already exists" we know the original
  // find failure was transient, and we return 503 to ask the client to
  // retry. createErr therefore covers both genuine create failures AND
  // the "find was actually a transient failure" case.
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
