export function renderSignupPage() {
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
    .card {
      width: min(100%, 440px);
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 18px 40px rgba(17, 24, 39, 0.08);
    }
    .brand { font-size: 28px; font-weight: 900; color: #ff4f9a; margin: 0 0 8px; }
    .subtitle { margin: 0 0 24px; color: #4b5563; line-height: 1.5; }
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
    .secondary { background: #f3f4f6; color: #111827; margin-top: 10px; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .hint { font-size: 12px; color: #6b7280; margin-top: 6px; line-height: 1.45; }
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
    .footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
    .footer a { color: #ff4f9a; }
  </style>
</head>
<body>
  <main class="card">
    <h1 class="brand">NINK</h1>
    <p class="subtitle">Create your account to get <strong>5.00 virtual NINK</strong> and sign off AI sessions with the browser extension.</p>

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
    <p class="footer">Already have an account? Sign in with the <a href="https://ni.nink.com">NINK browser extension</a>.</p>
  </main>

  <script>
    const statusEl = document.getElementById("status");
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
          "Account created with 5.00 NINK. Open the NINK browser extension and sign in with your email and password."
        );
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
