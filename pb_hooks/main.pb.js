/// <reference path="../pb_data/types.d.ts" />

// ─── Hook 1: Generate order number before save ──────────────────────────────

onRecordCreateRequest(function(e) {
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

// ─── Hook 2: Send emails after successful save ─────────────────────────────

onRecordAfterCreateSuccess(function(e) {
  var resendKey = $os.getenv("RESEND_API_KEY");
  if (!resendKey) {
    console.log("RESEND_API_KEY not set — skipping email notifications");
    return;
  }

  var record = e.record;
  var orderNumber = record.get("order_number");
  var name = record.get("name");
  var email = record.get("email");
  var org = record.get("organization") || "\u2014";
  var config = record.get("config") || {};
  var monthly = record.get("monthly_total");
  var annual = record.get("annual_total");
  var recordId = record.id;

  var deploy = config.deploy || "local";
  var platform = config.platform || "\u2014";
  var compute = config.compute || "\u2014";
  var memory = config.memory || "\u2014";
  var storage = config.storage || "\u2014";
  var software = config.software || "core";
  var support = config.support || "community";
  var access = config.access || {};
  var accessList = Object.keys(access).filter(function(k) { return access[k]; }).join(", ") || "None";

  // Helper: table row
  function tr(label, value) {
    return '<tr><td style="padding:4px 12px 4px 0; color:#666;">' + label + '</td><td>' + value + '</td></tr>';
  }

  function sectionBreak(title) {
    return '<tr><td colspan="2" style="padding:12px 0 4px; border-top:1px solid #eee;"><strong>' + title + '</strong></td></tr>';
  }

  // --- Team notification email ---
  var teamHtml =
    '<h2>New Quote Request \u2014 ' + orderNumber + '</h2>' +
    '<table style="border-collapse:collapse; font-family:sans-serif; font-size:14px;">' +
    tr("Order", "<strong>" + orderNumber + "</strong>") +
    tr("Name", "<strong>" + name + "</strong>") +
    tr("Email", '<a href="mailto:' + email + '">' + email + '</a>') +
    tr("Organization", org) +
    sectionBreak("Configuration") +
    tr("Deployment", deploy) +
    tr("Platform", platform) +
    tr("Compute", compute) +
    tr("Memory", memory) +
    tr("Storage", storage) +
    tr("Software", software) +
    tr("Support", support) +
    tr("Remote Access", accessList) +
    sectionBreak("Pricing") +
    tr("Monthly", "<strong>$" + monthly + "/mo</strong>") +
    tr("Annual (15% off)", "$" + annual + "/yr") +
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
        subject: "New Hardware Quote \u2014 " + orderNumber + " \u2014 " + name,
        html: teamHtml,
      }),
    });
    console.log("Team notification sent for " + orderNumber);
  } catch (err) {
    console.log("Failed to send team notification: " + err);
  }

  // --- Customer confirmation email ---
  var customerHtml =
    '<div style="max-width:600px; margin:0 auto; font-family:sans-serif; color:#333;">' +
    '<div style="background:#1a1a2e; padding:24px; text-align:center;">' +
    '<span style="color:#fff; font-size:20px; font-weight:bold;">Sage</span>' +
    '</div>' +
    '<div style="padding:32px 24px; background:#fff;">' +
    '<p style="margin:0 0 16px;">Hi ' + name + ',</p>' +
    '<p style="margin:0 0 24px;">We\u2019ve received your hardware configuration request. Here\u2019s a summary of what you submitted:</p>' +
    '<div style="background:#f5f5f5; padding:16px; border-radius:8px; text-align:center; margin:0 0 24px;">' +
    '<div style="color:#666; font-size:13px;">Your reference number</div>' +
    '<div style="font-size:24px; font-weight:bold; letter-spacing:2px; margin-top:4px;">' + orderNumber + '</div>' +
    '</div>' +
    '<table style="border-collapse:collapse; font-size:14px; width:100%; margin:0 0 24px;">' +
    tr("Deployment", deploy) +
    tr("Platform", platform) +
    tr("Compute", compute) +
    tr("Memory", memory) +
    tr("Storage", storage) +
    tr("Software", software) +
    tr("Support", support) +
    tr("Remote Access", accessList) +
    '</table>' +
    '<p style="margin:0 0 16px;">Our team will review your request and reach out within 1\u20132 business days to discuss next steps.</p>' +
    '<p style="margin:0; color:#666;">If you have questions in the meantime, just reply to this email or reach us at <a href="mailto:join.us@sage.is">join.us@sage.is</a>.</p>' +
    '</div>' +
    '<div style="padding:16px 24px; color:#999; font-size:12px; text-align:center;">' +
    'Sage \u2014 <a href="https://sage.is" style="color:#999;">sage.is</a>' +
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
        subject: "Your quote request " + orderNumber,
        html: customerHtml,
      }),
    });
    console.log("Customer confirmation sent for " + orderNumber);
  } catch (err) {
    console.log("Failed to send customer confirmation: " + err);
  }
}, "orders");
