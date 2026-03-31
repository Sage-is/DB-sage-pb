/// <reference path="../pb_data/types.d.ts" />

// Send email notification via Resend when a new order is created
onRecordCreateRequest((e) => {
  const record = e.record;

  const name = record.get("name");
  const email = record.get("email");
  const org = record.get("organization") || "—";
  const config = record.get("config");
  const monthly = record.get("monthly_total");
  const annual = record.get("annual_total");

  // Build a readable config summary
  const deploy = config.deploy || "local";
  const platform = config.platform || "—";
  const compute = config.compute || "—";
  const memory = config.memory || "—";
  const storage = config.storage || "—";
  const software = config.software || "core";
  const support = config.support || "community";
  const access = config.access || {};
  const accessList = Object.keys(access).filter(k => access[k]).join(", ") || "None";

  const subject = `New Hardware Quote Request — ${name}`;
  const html = `
    <h2>New Quote Request</h2>
    <table style="border-collapse:collapse; font-family:sans-serif; font-size:14px;">
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Name</td><td><strong>${name}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Organization</td><td>${org}</td></tr>
      <tr><td colspan="2" style="padding:12px 0 4px; border-top:1px solid #eee;"><strong>Configuration</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Deployment</td><td>${deploy}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Platform</td><td>${platform}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Compute</td><td>${compute}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Memory</td><td>${memory}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Storage</td><td>${storage}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Software</td><td>${software}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Support</td><td>${support}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Remote Access</td><td>${accessList}</td></tr>
      <tr><td colspan="2" style="padding:12px 0 4px; border-top:1px solid #eee;"><strong>Pricing</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Monthly</td><td><strong>$${monthly}/mo</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Annual (15% off)</td><td>$${annual}/yr</td></tr>
    </table>
    <p style="margin-top:20px; color:#666; font-size:13px;">
      View and manage this order in the <a href="https://pb.sage.is/_/">PocketBase admin</a>.
    </p>
  `;

  // Resend API key from environment
  const resendKey = $os.getenv("RESEND_API_KEY");
  if (!resendKey) {
    console.log("RESEND_API_KEY not set — skipping email notification");
    e.next();
    return;
  }

  try {
    $http.send({
      url: "https://api.resend.com/emails",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Sage Orders <orders@sage.is>",
        to: ["team@sage.is"],
        reply_to: email,
        subject: subject,
        html: html,
      }),
    });
  } catch (err) {
    console.log("Failed to send email notification:", err);
  }

  e.next();
}, "orders");
