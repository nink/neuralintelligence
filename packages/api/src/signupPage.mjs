function extensionInstallConfig() {
  const publicBase = process.env.NINK_PUBLIC_BASE_URL || "https://ni.nink.com";
  const chromeWebStore = String(process.env.NINK_CHROME_WEB_STORE_URL || "").trim();
  return { publicBase, chromeWebStore };
}

const CHROME_LOGO_SVG = `<svg class="chrome-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <circle cx="24" cy="24" r="22" fill="#fff"/>
  <path fill="#DB4437" d="M24 8c6.2 0 11.7 3 15.1 7.6L30.5 24 24 8z"/>
  <path fill="#0F9D58" d="M8.9 30.4A16 16 0 0 1 8 24c0-2.1.4-4.1 1.1-6L24 24 8.9 30.4z"/>
  <path fill="#FFCD40" d="M24 40a16 16 0 0 1-14.1-8.4L24 24l-14.1 8.4A15.9 15.9 0 0 0 24 40z"/>
  <path fill="#4285F4" d="M40 24c0 5.5-2.2 10.5-5.8 14.1L24 24h16z"/>
  <circle cx="24" cy="24" r="9" fill="#fff"/>
  <circle cx="24" cy="24" r="7" fill="#4285F4"/>
</svg>`;

export function renderSignupPage() {
  const { publicBase, chromeWebStore } = extensionInstallConfig();
  const installUrl = `${publicBase}/extension/install`;
  const storeLink = chromeWebStore
    ? `<a class="install-btn install-btn-primary" href="${chromeWebStore}" target="_blank" rel="noopener noreferrer">
        ${CHROME_LOGO_SVG}
        <span>Install from Chrome Web Store</span>
      </a>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Create your NINK account</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: linear-gradient(160deg, #fff7fb 0%, #f3f6ff 100%);
      color: #111827;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .layout {
      width: min(100%, 920px);
      display: grid;
      gap: 20px;
      grid-template-columns: 1fr;
    }
    @media (min-width: 860px) {
      .layout { grid-template-columns: 1fr 1fr; align-items: start; }
    }
    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 18px 40px rgba(17, 24, 39, 0.08);
    }
    .brand { font-size: 28px; font-weight: 900; color: #ff4f9a; margin: 0 0 8px; }
    .subtitle { margin: 0 0 20px; color: #4b5563; line-height: 1.5; font-size: 15px; }
    label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
    input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      font-size: 15px;
    }
    input:focus { outline: 2px solid #ffb8d8; border-color: #ff4f9a; }
    button {
      width: 100%;
      margin-top: 18px;
      padding: 13px 16px;
      border: 0;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }
    .primary { background: #ff4f9a; color: #fff; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .status {
      margin-top: 16px;
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.45;
      display: none;
    }
    .status.show { display: block; }
    .status.info { background: #eff6ff; color: #1d4ed8; }
    .status.success { background: #ecfdf5; color: #047857; }
    .status.error { background: #fef2f2; color: #b91c1c; }
    .step2 { display: none; margin-top: 8px; }
    .step2.show { display: block; }
    ul.rules { margin: 8px 0 0; padding-left: 18px; color: #6b7280; font-size: 12px; }
    ul.rules li.ok { color: #047857; }
    .footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; line-height: 1.5; }
    .footer a { color: #ff4f9a; font-weight: 600; }
    .install-card h2 {
      margin: 0 0 6px;
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .install-card p { margin: 0 0 14px; color: #4b5563; font-size: 14px; line-height: 1.5; }
    .chrome-logo { width: 28px; height: 28px; flex-shrink: 0; }
    .install-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      padding: 14px 16px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      margin-bottom: 12px;
      border: 1px solid #ff4f9a;
      background: #ff4f9a;
      color: #fff;
      box-shadow: 0 4px 14px rgba(255, 79, 154, 0.25);
    }
    .install-btn:hover { filter: brightness(0.98); }
    .install-btn .chrome-logo { width: 32px; height: 32px; }
    .install-steps {
      margin: 0;
      padding-left: 20px;
      color: #374151;
      font-size: 13px;
      line-height: 1.55;
    }
    .install-steps li { margin-bottom: 8px; }
    .install-steps a { color: #2563eb; font-weight: 600; }
    .install-steps code {
      font-size: 12px;
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .next-steps {
      display: none;
      margin-top: 14px;
      padding: 14px;
      border-radius: 10px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      font-size: 13px;
      line-height: 1.55;
      color: #166534;
    }
    .next-steps.show { display: block; }
    .next-steps strong { display: block; margin-bottom: 6px; font-size: 14px; }
    .next-steps ol { margin: 8px 0 0; padding-left: 18px; }
  </style>
</head>
<body>
  <div class="layout">
    <main class="card">
      <h1 class="brand">NINK</h1>
      <p class="subtitle">Create your account to get <strong>500 credits</strong> (5.00 NINK). Sign off AI sessions, save encrypted evidence packages, and share access with other NINK users.</p>

      <form id="signup-form" novalidate>
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required placeholder="you@example.com">

        <button type="button" class="primary" id="send-code-btn">Send verification code</button>

        <div class="step2" id="step2">
          <label for="code">Verification code</label>
          <input id="code" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6-digit code">

          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="new-password" placeholder="Create a password">

          <label for="confirm">Confirm password</label>
          <input id="confirm" name="confirm" type="password" autocomplete="new-password" placeholder="Repeat password">

          <ul class="rules" id="rules">
            <li id="rule-length">At least 8 characters</li>
            <li id="rule-lower">One lowercase letter</li>
            <li id="rule-upper">One uppercase letter</li>
            <li id="rule-number">One number</li>
            <li id="rule-symbol">One symbol (! @ # $ …)</li>
            <li id="rule-match">Passwords match</li>
          </ul>

          <button type="submit" class="primary" id="create-btn">Create account</button>
        </div>
      </form>

      <div class="status" id="status" role="status"></div>
      <div class="next-steps" id="next-steps">
        <strong>Account ready — next steps</strong>
        <ol>
          <li><a href="${installUrl}">Install the Chrome extension</a> (one copy command)</li>
          <li>Sign in from the NINK icon with this email and password</li>
          <li>Sign off a ChatGPT session → share the <code>.nink</code> file with your demo partner</li>
        </ol>
      </div>
      <p class="footer">Already have an account? Sign in via the extension popup after installing.</p>
    </main>

    <aside class="card install-card" aria-labelledby="install-heading">
      <h2 id="install-heading">
        ${CHROME_LOGO_SVG}
        Install Chrome extension
      </h2>
      <p>Extension files are hosted on <strong>ni.nink.com</strong> — no GitHub zip. Run one install command to copy them locally, then Load unpacked in Chrome.</p>
      ${storeLink}
      <a class="install-btn" href="${installUrl}">
        ${CHROME_LOGO_SVG}
        <span>Install instructions</span>
      </a>
      <ol class="install-steps">
        <li>Open <a href="${installUrl}">ni.nink.com/extension/install</a></li>
        <li>Copy the Windows or Mac install command (downloads <code>~/nink-extension</code>)</li>
        <li><a href="chrome://extensions/">chrome://extensions</a> → Developer mode → <strong>Load unpacked</strong></li>
      </ol>
      <p style="font-size:12px;color:#6b7280;margin-top:14px">Files: <a href="${publicBase}/extension/manifest.json">/extension/manifest.json</a></p>
    </aside>
  </div>

  <script>
    const statusEl = document.getElementById("status");
    const nextStepsEl = document.getElementById("next-steps");
    const step2 = document.getElementById("step2");
    const emailEl = document.getElementById("email");
    const codeEl = document.getElementById("code");
    const passwordEl = document.getElementById("password");
    const confirmEl = document.getElementById("confirm");
    const sendCodeBtn = document.getElementById("send-code-btn");
    const createBtn = document.getElementById("create-btn");

    function showStatus(kind, message) {
      statusEl.className = "status show " + kind;
      statusEl.textContent = message;
    }

    function validatePasswordClient(value) {
      return {
        length: value.length >= 8 && value.length <= 128,
        lower: /[a-z]/.test(value),
        upper: /[A-Z]/.test(value),
        number: /[0-9]/.test(value),
        symbol: /[^A-Za-z0-9]/.test(value),
      };
    }

    function refreshRules() {
      const value = passwordEl.value;
      const checks = validatePasswordClient(value);
      document.getElementById("rule-length").className = checks.length ? "ok" : "";
      document.getElementById("rule-lower").className = checks.lower ? "ok" : "";
      document.getElementById("rule-upper").className = checks.upper ? "ok" : "";
      document.getElementById("rule-number").className = checks.number ? "ok" : "";
      document.getElementById("rule-symbol").className = checks.symbol ? "ok" : "";
      document.getElementById("rule-match").className =
        value && value === confirmEl.value ? "ok" : "";
    }

    passwordEl.addEventListener("input", refreshRules);
    confirmEl.addEventListener("input", refreshRules);

    sendCodeBtn.addEventListener("click", async () => {
      const email = emailEl.value.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        showStatus("error", "Enter a valid email address.");
        return;
      }

      sendCodeBtn.disabled = true;
      showStatus("info", "Sending verification code…");

      try {
        const response = await fetch("/v1/auth/signup/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.status === "ERROR") {
          throw new Error(payload.message || "Could not send verification code.");
        }
        step2.classList.add("show");
        showStatus("success", payload.message || "Verification code sent. Check your inbox.");
        codeEl.focus();
      } catch (error) {
        showStatus("error", error.message || "Could not send verification code.");
      } finally {
        sendCodeBtn.disabled = false;
      }
    });

    document.getElementById("signup-form").addEventListener("submit", async (event) => {
      event.preventDefault();

      const email = emailEl.value.trim().toLowerCase();
      const code = codeEl.value.trim();
      const password = passwordEl.value;
      const confirm = confirmEl.value;
      const checks = validatePasswordClient(password);

      if (!code || code.length !== 6) {
        showStatus("error", "Enter the 6-digit verification code from your email.");
        return;
      }

      if (!checks.length || !checks.lower || !checks.upper || !checks.number || !checks.symbol) {
        showStatus("error", "Password does not meet the requirements.");
        return;
      }

      if (password !== confirm) {
        showStatus("error", "Passwords do not match.");
        return;
      }

      createBtn.disabled = true;
      showStatus("info", "Creating your account…");
      nextStepsEl.classList.remove("show");

      try {
        const response = await fetch("/v1/auth/signup/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code, password }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.status === "ERROR") {
          throw new Error(payload.message || "Signup failed.");
        }
        showStatus(
          "success",
          "Account created with 500 credits. Install the Chrome extension (right panel), then sign in from the extension popup."
        );
        nextStepsEl.classList.add("show");
        document.getElementById("signup-form").reset();
        step2.classList.remove("show");
        refreshRules();
      } catch (error) {
        showStatus("error", error.message || "Signup failed.");
      } finally {
        createBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
