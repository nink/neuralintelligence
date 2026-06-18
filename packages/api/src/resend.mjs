const RESEND_API_URL = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendResendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "NINK <hello@nink.com>";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Resend error ${response.status}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function sendSignupVerificationEmail({ email, code }) {
  const safeEmail = escapeHtml(email);
  const safeCode = escapeHtml(code);
  const signupUrl = process.env.NINK_PUBLIC_BASE_URL || "https://ni.nink.com";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:560px">
      <p style="font-size:28px;font-weight:900;color:#ff4f9a;margin:0 0 16px">NINK</p>
      <p>Confirm your email to create your NINK account and receive <strong>5.00 virtual NINK</strong> for sign-offs.</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:0.25em;margin:24px 0">${safeCode}</p>
      <p>Enter this code on the signup page:</p>
      <p><a href="${escapeHtml(signupUrl)}/signup" style="color:#ff4f9a;font-weight:700">${escapeHtml(signupUrl)}/signup</a></p>
      <p style="color:#777;font-size:13px">This code expires in 15 minutes. If you did not request a NINK account, ignore this email.</p>
      <p style="color:#777;font-size:13px">Signed up for ${safeEmail}</p>
    </div>
  `.trim();

  return sendResendEmail({
    to: email,
    subject: "Your NINK signup verification code",
    html,
  });
}

export async function sendAccessRequestEmail({
  ownerEmail,
  requesterEmail,
  packageTitle,
  packageId,
  message,
  approveUrl,
  denyUrl,
}) {
  const safeTitle = escapeHtml(packageTitle || "Evidence package");
  const safeRequester = escapeHtml(requesterEmail);
  const safeMessage = message ? escapeHtml(message) : "";
  const safePackageId = escapeHtml(packageId);

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:560px">
      <p style="font-size:28px;font-weight:900;color:#ff4f9a;margin:0 0 16px">NINK</p>
      <p><strong>${safeRequester}</strong> is asking to view your cloud-backed evidence package:</p>
      <p style="font-size:18px;font-weight:700;margin:16px 0">${safeTitle}</p>
      <p style="color:#555;font-size:13px">Package ID: ${safePackageId}</p>
      ${
        safeMessage
          ? `<p style="background:#f5f5f5;padding:12px;border-radius:8px"><strong>Message:</strong> ${safeMessage}</p>`
          : ""
      }
      <p>If you approve, they can unlock the package in the NINK viewer using <strong>their own NINK credits</strong> (10 credits to view).</p>
      <p style="margin:28px 0">
        <a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;margin-right:12px">Approve access</a>
        <a href="${escapeHtml(denyUrl)}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Deny access</a>
      </p>
      <p style="color:#777;font-size:13px">If you deny, they cannot unlock this package via the cloud API. Local .ninkkey decrypt stays disabled for cloud-backed packages.</p>
    </div>
  `.trim();

  return sendResendEmail({
    to: ownerEmail,
    subject: `NINK access request from ${requesterEmail}`,
    html,
  });
}

export async function sendAccessApprovedNoticeEmail({
  requesterEmail,
  ownerEmail,
  packageTitle,
  packageId,
}) {
  const safeTitle = escapeHtml(packageTitle || "Evidence package");
  const safeOwner = escapeHtml(ownerEmail);
  const viewerUrl = process.env.NINK_PUBLIC_BASE_URL || "https://ni.nink.com";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:560px">
      <p style="font-size:28px;font-weight:900;color:#ff4f9a;margin:0 0 16px">NINK</p>
      <p><strong>${safeOwner}</strong> approved your access request for:</p>
      <p style="font-size:18px;font-weight:700;margin:16px 0">${safeTitle}</p>
      <p>Open the package in the NINK Session Viewer while signed in, then use <strong>Cloud unlock</strong> (10 credits to view).</p>
      <p style="color:#777;font-size:13px">Package ID: ${escapeHtml(packageId)}</p>
      <p><a href="${escapeHtml(viewerUrl)}" style="color:#ff4f9a;font-weight:700">${escapeHtml(viewerUrl)}</a></p>
    </div>
  `.trim();

  return sendResendEmail({
    to: requesterEmail,
    subject: "Your NINK evidence package access was approved",
    html,
  });
}

export async function sendAccessDeniedNoticeEmail({ requesterEmail, ownerEmail, packageTitle }) {
  const safeTitle = escapeHtml(packageTitle || "Evidence package");
  const safeOwner = escapeHtml(ownerEmail);

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;max-width:560px">
      <p style="font-size:28px;font-weight:900;color:#ff4f9a;margin:0 0 16px">NINK</p>
      <p><strong>${safeOwner}</strong> denied your access request for:</p>
      <p style="font-size:18px;font-weight:700;margin:16px 0">${safeTitle}</p>
      <p>You cannot unlock this cloud-backed package unless the owner approves a future request.</p>
    </div>
  `.trim();

  return sendResendEmail({
    to: requesterEmail,
    subject: "Your NINK evidence package access was denied",
    html,
  });
}
