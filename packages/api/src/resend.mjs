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
