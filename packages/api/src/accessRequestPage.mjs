function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAccessRequestResultPage(result) {
  const title = escapeHtml(result?.packageTitle || "Evidence package");
  const requester = escapeHtml(result?.requesterEmail || "the requester");
  const owner = escapeHtml(result?.ownerEmail || "the owner");
  const already = Boolean(result?.alreadyResolved);

  let headline = "Access request updated";
  let body = `<p>Your response was recorded.</p>`;

  if (result?.action === "approved") {
    headline = already ? "Access already approved" : "Access approved";
    body = `
      <p>You approved <strong>${requester}</strong> to unlock <strong>${title}</strong>.</p>
      <p>They can now open the package in the NINK viewer using their own NINK credits (10 credits to view, 5 to verify, 5 for a report).</p>
      <p style="color:#777;font-size:14px">Local .ninkkey decrypt remains disabled for cloud-backed packages — unlock is via the cloud API only.</p>
    `;
  } else if (result?.action === "denied") {
    headline = already ? "Access already denied" : "Access denied";
    body = `
      <p>You denied <strong>${requester}</strong> access to <strong>${title}</strong>.</p>
      <p>They cannot unlock this cloud-backed package unless you approve a future request.</p>
    `;
  } else if (result?.message) {
    headline = "Could not process request";
    body = `<p>${escapeHtml(result.message)}</p>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline} · NINK</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0f1419; color: #e8eef7; margin: 0; padding: 32px 16px; }
    .card { max-width: 560px; margin: 0 auto; background: #1a2332; border: 1px solid #2d3a4f; border-radius: 12px; padding: 28px; line-height: 1.55; }
    h1 { margin: 0 0 12px; font-size: 1.5rem; }
    .brand { color: #ff4f9a; font-weight: 900; font-size: 1.1rem; margin-bottom: 20px; }
    a { color: #4f8cff; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">NINK</div>
    <h1>${escapeHtml(headline)}</h1>
    ${body}
    <p style="margin-top:24px;color:#8fa3bf;font-size:14px">Signed in as ${owner}. You can close this tab.</p>
  </div>
</body>
</html>`;
}
