/// <reference path="../pb_data/types.d.ts" />

// ─── Hook 1: Pre-create — spam guards + order number ────────────────────────

onRecordCreateRequest(function(e) {
  // Spam guard A — server-side honeypot. The website form never submits
  // `notes`, so any non-empty value here is a bot that auto-fills the
  // schema. Reject with a generic 400 so the bot can't probe for the
  // specific reason.
  var notesField = e.record.get("notes");
  if (notesField && String(notesField).trim().length > 0) {
    console.log("Honeypot tripped (notes field) for " + e.record.get("email"));
    throw new BadRequestError("Invalid submission.");
  }

  // Spam guard B — per-email rate limit. Three requests per email per
  // hour catches the abusive case (someone using the form to spam a
  // target) without punishing a real user who retries after a missed
  // confirmation.
  var submittedEmail = e.record.get("email");
  if (submittedEmail) {
    try {
      var oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      var recent = e.app.findRecordsByFilter(
        "orders",
        "email = {:email} && created >= {:since}",
        "-created",
        10, 0,
        { email: submittedEmail, since: oneHourAgo }
      );
      if (recent && recent.length >= 3) {
        console.log("Rate limit hit for " + submittedEmail + " (" + recent.length + " in last hour)");
        throw new BadRequestError("Too many recent submissions. Please try again later.");
      }
    } catch (err) {
      // BadRequestError must bubble up — re-throw it. Any other error
      // (e.g. query failure) is logged and ignored so a backend hiccup
      // never breaks the form for real users.
      if (err && err.name === "BadRequestError") throw err;
      console.log("Rate-limit check failed (allowing): " + err);
    }
  }

  // ─── Generate order number ───
  var areaCodes = [212, 718, 416, 514, 604, 351, 440, 415, 310, 305, 312, 617];
  var letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  var digits = "0123456789";

  var letter = $security.randomStringWithAlphabet(1, letters);
  var area = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  var mid = $security.randomStringWithAlphabet(3, digits);
  var end = $security.randomStringWithAlphabet(4, digits);
  var orderNum = letter + "-" + area + "-" + mid + "-" + end;

  console.log("Order " + orderNum + " created for " + e.record.get("name"));
  e.record.set("order_number", orderNum);
  e.next();
}, "orders");

// ─── Hook 2: Post-create — send emails ──────────────────────────────────────

onRecordAfterCreateSuccess(function(e) {
  var record = e.record;

  var resendKey = $os.getenv("RESEND_API_KEY");
  if (!resendKey) {
    console.log("RESEND_API_KEY not set — skipping email notifications");
    return;
  }

  var orderNumber = record.get("order_number");
  var name = record.get("name");
  var email = record.get("email");
  var org = record.get("organization") || "—";
  // PocketBase JSVM (Goja) wraps Go []byte (types.JsonRaw) as a JS Array of
  // byte values. JSON.stringify() on that gives "[123,34,...]" — useless.
  // String() coerces the byte slice back to UTF-8, giving the raw JSON text,
  // which JSON.parse() then deserialises into a proper JS object.
  var config = {};
  try {
    var configRaw = record.get("config");
    if (configRaw) {
      config = JSON.parse(String(configRaw)) || {};
    }
  } catch (err) {
    console.log("Config parse error: " + err);
  }
  var monthly = record.get("monthly_total");
  var annual = record.get("annual_total");
  var recordId = record.id;

  // Friendly names from the client (config._display). Fall back to the
  // raw ID if the client didn't send it (older form versions, mailto fallback).
  var display = (config && config._display) || {};
  var dx = function(key, fallback) {
    if (display[key] !== undefined && display[key] !== null && display[key] !== "") return display[key];
    if (config[key] !== undefined && config[key] !== null && config[key] !== "") return config[key];
    return fallback;
  };

  var isCloud = (config.deploy || "") === "cloud";
  var qty = Number(display.quantity || config.quantity || 1);
  var qtySuffix = qty > 1 ? " × " + qty : "";

  var deploy = dx("deploy", "—");
  var platform = dx("platform", "—");
  var compute = dx("compute", "—");
  var memory = dx("memory", "—");
  var storage = dx("storage", "—");
  var software = dx("software", "—");
  var support = dx("support", "—");
  var accessList = display.accessList || "None";
  var configUrl = display.configUrl || null;

  // Helper: table row
  function tr(label, value) {
    return '<tr><td style="padding:4px 12px 4px 0; color:#666;">' + label + '</td><td>' + value + '</td></tr>';
  }

  function sectionBreak(title) {
    return '<tr><td colspan="2" style="padding:12px 0 4px; border-top:1px solid #eee;"><strong>' + title + '</strong></td></tr>';
  }

  // Build the configuration rows. In Cloud Managed, the customer didn't pick
  // hardware — show "Managed by Sage" instead of empty hardware rows.
  function configRows() {
    var rows = tr("Deployment", deploy);
    if (isCloud) {
      rows += tr("Infrastructure", "Managed by Sage");
    } else {
      rows += tr("Platform", platform);
      rows += tr("Compute", compute + qtySuffix);
      rows += tr("Memory", memory + (qty > 1 ? " (per machine)" : ""));
      rows += tr("Storage", storage + (qty > 1 ? " (per machine)" : ""));
      rows += tr("Remote Access", accessList);
    }
    rows += tr("Software", software);
    rows += tr("Support", support);
    return rows;
  }

  // --- Team notification email ---
  var teamHtml =
    '<h2>New Quote Request — ' + orderNumber + '</h2>' +
    '<table style="border-collapse:collapse; font-family:sans-serif; font-size:14px;">' +
    tr("Order", "<strong>" + orderNumber + "</strong>") +
    tr("Name", "<strong>" + name + "</strong>") +
    tr("Email", '<a href="mailto:' + email + '">' + email + '</a>') +
    tr("Organization", org) +
    sectionBreak("Configuration") +
    configRows() +
    sectionBreak("Pricing") +
    tr("Monthly", "<strong>$" + monthly + "/mo</strong>") +
    tr("Annual (15% off)", "$" + annual + "/yr") +
    (configUrl ? tr("Config link", '<a href="' + configUrl + '">View on sage.is ↗</a>') : '') +
    '</table>' +
    '<p style="margin-top:20px; color:#666; font-size:13px;">' +
    '<a href="https://pb.sage.is/_/#/collections/orders/records/' + recordId + '">View in PocketBase admin</a>' +
    '</p>';

  try {
    $http.send({
      url: "https://api.resend.com/emails",
      method: "POST",
      headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sage Orders <orders@sage.is>",
        to: ["join.us@sage.is"],
        reply_to: email,
        subject: "New Hardware Quote — " + orderNumber + " — " + name,
        html: teamHtml,
      }),
    });
    console.log("Team notification sent for " + orderNumber);
  } catch (err) {
    console.log("Failed to send team notification: " + err);
  }

  // --- Customer confirmation email (CC'd to join.us@sage.is) ---
  var customerHtml =
    '<div style="max-width:600px; margin:0 auto; font-family:sans-serif; color:#333;">' +
    '<div style="background:#1a1a2e; padding:24px; text-align:center;">' +
    '<span style="color:#fff; font-size:20px; font-weight:bold;">Sage</span>' +
    '</div>' +
    '<div style="padding:32px 24px; background:#fff;">' +
    '<p style="margin:0 0 16px;">Hi ' + name + ',</p>' +
    '<p style="margin:0 0 24px;">We’ve received your hardware configuration request. Here’s a summary of what you submitted:</p>' +
    '<div style="background:#f5f5f5; padding:16px; border-radius:8px; text-align:center; margin:0 0 24px;">' +
    '<div style="color:#666; font-size:13px;">Your reference number</div>' +
    '<div style="font-size:24px; font-weight:bold; letter-spacing:2px; margin-top:4px;">' + orderNumber + '</div>' +
    (configUrl ? '<a href="' + configUrl + '" style="display:inline-block; margin-top:10px; font-size:13px; color:#1a1a2e; font-weight:600; text-decoration:none;">↗ View your configuration on sage.is</a>' : '') +
    '</div>' +
    '<table style="border-collapse:collapse; font-size:14px; width:100%; margin:0 0 24px;">' +
    configRows() +
    '</table>' +
    (configUrl ? '<p style="margin:0 0 24px;"><a href="' + configUrl + '" style="color:#1a1a2e; font-weight:600; font-size:14px;">↗ View or share this configuration on sage.is</a></p>' : '') +
    '<p style="margin:0 0 16px;">Our team will review your request and reach out within 1–2 business days to discuss next steps.</p>' +
    '<p style="margin:0; color:#666;">If you have questions in the meantime, just reply to this email or reach us at <a href="mailto:join.us@sage.is">join.us@sage.is</a>.</p>' +
    '</div>' +
    '<div style="padding:16px 24px; color:#999; font-size:12px; text-align:center;">' +
    'Sage — <a href="https://sage.is" style="color:#999;">sage.is</a>' +
    '</div>' +
    '</div>';

  try {
    $http.send({
      url: "https://api.resend.com/emails",
      method: "POST",
      headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sage <orders@sage.is>",
        to: [email],
        cc: ["join.us@sage.is"],
        subject: "Your quote request " + orderNumber,
        html: customerHtml,
      }),
    });
    console.log("Customer confirmation sent for " + orderNumber + " (CC join.us@sage.is)");
  } catch (err) {
    console.log("Failed to send customer confirmation: " + err);
  }
}, "orders");
