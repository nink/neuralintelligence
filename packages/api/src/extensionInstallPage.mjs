const CHROME_LOGO_SVG = `<svg class="chrome-logo" viewBox="0 0 48 48" aria-hidden="true">
  <circle cx="24" cy="24" r="22" fill="#fff"/>
  <path fill="#DB4437" d="M24 8c6.2 0 11.7 3 15.1 7.6L30.5 24 24 8z"/>
  <path fill="#0F9D58" d="M8.9 30.4A16 16 0 0 1 8 24c0-2.1.4-4.1 1.1-6L24 24 8.9 30.4z"/>
  <path fill="#FFCD40" d="M24 40a16 16 0 0 1-14.1-8.4L24 24l-14.1 8.4A15.9 15.9 0 0 0 24 40z"/>
  <path fill="#4285F4" d="M40 24c0 5.5-2.2 10.5-5.8 14.1L24 24h16z"/>
  <circle cx="24" cy="24" r="9" fill="#fff"/>
  <circle cx="24" cy="24" r="7" fill="#4285F4"/>
</svg>`;

export function renderExtensionInstallPage() {
  const publicBase = process.env.NINK_PUBLIC_BASE_URL || "https://ni.nink.com";
  const chromeWebStore = String(process.env.NINK_CHROME_WEB_STORE_URL || "").trim();

  const storeBlock = chromeWebStore
    ? `<a class="btn btn-primary" href="${chromeWebStore}" target="_blank" rel="noopener noreferrer">${CHROME_LOGO_SVG} Install from Chrome Web Store</a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Install NINK Chrome extension</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: linear-gradient(160deg, #fff7fb 0%, #f3f6ff 100%);
      color: #111827;
      padding: 24px;
    }
    .wrap { max-width: 640px; margin: 0 auto; }
    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 18px 40px rgba(17, 24, 39, 0.08);
    }
    .brand { font-size: 28px; font-weight: 900; color: #ff4f9a; margin: 0 0 8px; }
    h1 { font-size: 1.35rem; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
    p, li { line-height: 1.55; color: #374151; font-size: 15px; }
    .note {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 14px;
      color: #1e40af;
      margin: 16px 0;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 16px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      border: 1px solid #e5e7eb;
      background: #f9fafb;
      color: #111827;
      margin-top: 10px;
      cursor: pointer;
    }
    .btn-primary { background: #ff4f9a; color: #fff; border-color: #ff4f9a; }
    .btn:hover { filter: brightness(0.98); }
    .chrome-logo { width: 28px; height: 28px; flex-shrink: 0; }
    code, pre {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 13px;
      background: #f3f4f6;
      border-radius: 8px;
    }
    code { padding: 2px 6px; }
    pre {
      padding: 14px;
      overflow-x: auto;
      margin: 10px 0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    ol { padding-left: 20px; }
    ol li { margin-bottom: 10px; }
    .footer { margin-top: 20px; font-size: 13px; color: #6b7280; text-align: center; }
    .footer a { color: #ff4f9a; font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">
    <main class="card">
      <p class="brand">NINK</p>
      <h1>${CHROME_LOGO_SVG} Install Chrome extension</h1>
      <p>Extension files are hosted on this server at <a href="${publicBase}/extension/manifest.json"><code>/extension/</code></a>. Chrome still needs a <strong>local folder</strong> — websites cannot flip Developer mode for you (browser security).</p>

      <div class="note">
        <strong>Easiest:</strong> run the install script once. It copies our hosted files into <code>~/nink-extension</code> (no zip).
      </div>

      ${storeBlock}

      <h2 style="font-size:1rem;margin:24px 0 8px">Windows</h2>
      <p>Open <strong>PowerShell</strong> and paste:</p>
      <pre id="ps-cmd">powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest '${publicBase}/extension/install.ps1' -OutFile '$env:TEMP\\nink-install.ps1'; & '$env:TEMP\\nink-install.ps1'"</pre>
      <button type="button" class="btn" id="copy-ps">Copy Windows command</button>

      <h2 style="font-size:1rem;margin:24px 0 8px">Mac / Linux</h2>
      <pre id="sh-cmd">curl -fsSL ${publicBase}/extension/install.sh | bash</pre>
      <button type="button" class="btn" id="copy-sh">Copy Mac/Linux command</button>

      <h2 style="font-size:1rem;margin:24px 0 8px">Then in Chrome</h2>
      <ol>
        <li>Open <a href="chrome://extensions/">chrome://extensions</a></li>
        <li>Turn on <strong>Developer mode</strong> (top-right)</li>
        <li><strong>Load unpacked</strong> → select <code>nink-extension</code> in your home folder</li>
        <li>Click the NINK icon → sign in → sign off a ChatGPT session</li>
      </ol>

      <p class="footer"><a href="${publicBase}/signup">Create account</a> · <a href="${publicBase}/extension/manifest.json">manifest.json</a></p>
    </main>
  </div>
  <script>
    document.getElementById("copy-ps")?.addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("ps-cmd").textContent);
    });
    document.getElementById("copy-sh")?.addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("sh-cmd").textContent);
    });
  </script>
</body>
</html>`;
}
