(function initNinkViewerCloud() {
  const PRODUCTION_API = "https://ni.nink.com";
  const CREDIT_WEI = 10n ** 16n;
  const FALLBACK_PACKAGE_FEES = { view: 10, verify: 5, report: 5 };

  const cloudAccessPanel = document.getElementById("cloud-access-panel");
  const cloudOpenBtn = document.getElementById("cloud-open-btn");
  const cloudVerifyBtn = document.getElementById("cloud-verify-btn");
  const cloudReportBtn = document.getElementById("cloud-report-btn");
  const cloudAskOwnerBtn = document.getElementById("cloud-ask-owner-btn");
  const cloudAccessMessage = document.getElementById("cloud-access-message");
  const cloudAccessMessageWrap = document.getElementById("cloud-access-message-wrap");
  const cloudStatus = document.getElementById("cloud-status");
  const cloudBalanceLabel = document.getElementById("cloud-balance-label");
  const cloudPackageTitle = document.getElementById("cloud-package-title");

  if (!cloudAccessPanel || !cloudOpenBtn) {
    return;
  }

  let packageViewCredits = null;
  let packageVerifyCredits = null;
  let packageReportCredits = null;

  function viewer() {
    return globalThis.__NINK_viewer__ || {};
  }

  function strictCloudHelpers() {
    return globalThis.__NINK_STRICT_CLOUD__ || {};
  }

  async function readNinkConfig() {
    if (!chrome?.storage?.local) {
      return { strictCloudMode: true };
    }
    const stored = await readExtensionStorage(["ninkConfig"]);
    return { strictCloudMode: true, ...(stored.ninkConfig || {}) };
  }

  function isStrictCloudMode(config) {
    const helpers = strictCloudHelpers();
    if (helpers.isStrictCloudModeEnabled) {
      return helpers.isStrictCloudModeEnabled(config);
    }
    return config?.strictCloudMode !== false;
  }

  function weiToCredits(wei) {
    return Number(BigInt(String(wei || 0)) / CREDIT_WEI);
  }

  function applyPackageFeeFallbacks(accounting) {
    if (packageViewCredits == null && accounting?.packageFees?.view?.credits != null) {
      packageViewCredits = accounting.packageFees.view.credits;
    }
    if (packageVerifyCredits == null && accounting?.packageFees?.verify?.credits != null) {
      packageVerifyCredits = accounting.packageFees.verify.credits;
    }
    if (packageReportCredits == null && accounting?.packageFees?.report?.credits != null) {
      packageReportCredits = accounting.packageFees.report.credits;
    }
    if (packageViewCredits == null && accounting?.feeCredits != null) {
      packageViewCredits = accounting.feeCredits;
    }
    if (packageViewCredits == null && accounting?.requiredFee) {
      packageViewCredits = weiToCredits(accounting.requiredFee);
    }
    if (packageViewCredits == null) {
      packageViewCredits = FALLBACK_PACKAGE_FEES.view;
    }
    if (packageVerifyCredits == null) {
      packageVerifyCredits = FALLBACK_PACKAGE_FEES.verify;
    }
    if (packageReportCredits == null) {
      packageReportCredits = FALLBACK_PACKAGE_FEES.report;
    }
  }

  function updateCloudButtonLabels() {
    cloudOpenBtn.textContent = `Open package · ${packageViewCredits} credits`;
    cloudVerifyBtn.textContent = `Verify integrity · ${packageVerifyCredits} credits`;
    cloudReportBtn.textContent = `Download report · ${packageReportCredits} credits`;
  }

  function readExtensionStorage(keys) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) {
        resolve({});
        return;
      }
      chrome.storage.local.get(keys, resolve);
    });
  }

  function resolveApiBase(config) {
    if (config?.useLocalApi === true) {
      return "http://127.0.0.1:8787";
    }
    return PRODUCTION_API;
  }

  async function loadPackageFees() {
    const stored = await readExtensionStorage(["ninkSession", "ninkConfig", "accounting"]);
    const session = stored.ninkSession;
    const config = stored.ninkConfig || {};

    if (stored.accounting?.packageFees?.view?.credits != null) {
      packageViewCredits = stored.accounting.packageFees.view.credits;
      packageVerifyCredits = stored.accounting.packageFees.verify?.credits ?? null;
      packageReportCredits = stored.accounting.packageFees.report?.credits ?? null;
      applyPackageFeeFallbacks(stored.accounting);
      updateCloudButtonLabels();
      return;
    }

    if (!session?.sessionToken) {
      applyPackageFeeFallbacks(stored.accounting);
      updateCloudButtonLabels();
      return;
    }

    const apiBase = resolveApiBase(config);
    try {
      const response = await fetch(`${apiBase}/v1/accounting/parameters`, {
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.packageFees?.view?.credits != null) {
        packageViewCredits = data.packageFees.view.credits;
        packageVerifyCredits = data.packageFees.verify?.credits ?? null;
        packageReportCredits = data.packageFees.report?.credits ?? null;
        await new Promise((resolve) => {
          chrome.storage.local.set(
            {
              accounting: {
                ...(stored.accounting || {}),
                userBalance: String(data.balance ?? stored.accounting?.userBalance ?? "0"),
                requiredFee: String(data.feeRequirement ?? stored.accounting?.requiredFee ?? "0"),
                packageFees: data.packageFees,
                feeCredits: data.feeCredits,
                balanceCredits: data.balanceCredits,
                source: data.source || "nink-cloud-api",
                updatedAt: Date.now(),
              },
            },
            resolve
          );
        });
      } else if (response.ok && data.feeCredits != null) {
        packageViewCredits = data.feeCredits;
      }
    } catch (_error) {
      // Keep fallbacks until API is reachable.
    }

    applyPackageFeeFallbacks(stored.accounting);
    updateCloudButtonLabels();
  }

    function showAskOwnerControls(labelText) {
      if (cloudAskOwnerBtn) {
        cloudAskOwnerBtn.hidden = false;
        cloudAskOwnerBtn.textContent = labelText || "Ask owner for access";
      }
      if (cloudAccessMessage) {
        cloudAccessMessage.hidden = false;
      }
      if (cloudAccessMessageWrap) {
        cloudAccessMessageWrap.hidden = false;
      }
    }

    async function refreshCloudAccessPanel() {
    const loadedSession = viewer().getLoadedSession?.();
    const cloudPanelHeading = document.getElementById("cloud-panel-heading");

    if (!loadedSession?.packageId) {
      cloudAccessPanel.classList.add("hidden");
      return;
    }

    const config = await readNinkConfig();
    const strictMode = isStrictCloudMode(config);

    await loadPackageFees();
    cloudAccessPanel.classList.remove("hidden");
    cloudPackageTitle.textContent = `Cloud-backed package · ${loadedSession.packageId}`;

    if (cloudPanelHeading) {
      cloudPanelHeading.textContent = strictMode
        ? "Cloud unlock (required)"
        : "Cloud unlock (optional — costs credits)";
    }

    if (cloudAskOwnerBtn) {
      cloudAskOwnerBtn.hidden = true;
      cloudAskOwnerBtn.disabled = false;
      cloudAskOwnerBtn.textContent = "Ask owner for access";
    }
    if (cloudAccessMessage) {
      cloudAccessMessage.hidden = true;
    }
    if (cloudAccessMessageWrap) {
      cloudAccessMessageWrap.hidden = true;
    }

    if (!strictMode && viewer().getLoadedSecretKey?.()) {
      cloudBalanceLabel.textContent =
        "Dev mode: local key loaded — conversation above. Cloud buttons disabled.";
      setCloudActionButtonsEnabled(false);
      return;
    }

    const stored = await readExtensionStorage(["ninkSession", "accounting"]);
    const session = stored.ninkSession;
    const accounting = stored.accounting;

    if (!session?.sessionToken) {
      cloudBalanceLabel.textContent = strictMode
        ? "Sign in via the extension popup (top-right NINK icon), then click Ask owner below."
        : "Sign in via the extension popup, or load your local .ninkkey (dev mode only).";
      setCloudActionButtonsEnabled(false);
      showAskOwnerControls("Ask owner for access (sign in first)");
      return;
    }

    const access = await fetchAccessStatus(loadedSession.packageId);
    const credits = accounting?.userBalance ? weiToCredits(accounting.userBalance) : null;
    const creditLine =
      credits != null
        ? `Your balance: ${credits} credits`
        : "Open the extension popup to refresh your credit balance.";

    if (access?.accessStatus === "owner") {
      cloudBalanceLabel.textContent = `${creditLine} · You own this package.`;
      setCloudActionButtonsEnabled(true);
      return;
    }

    if (access?.accessStatus === "granted") {
      cloudBalanceLabel.textContent = `${creditLine} · Owner approved your access — unlock with your credits.`;
      setCloudActionButtonsEnabled(true);
      return;
    }

    setCloudActionButtonsEnabled(false);

    if (access?.accessStatus === "pending") {
      cloudBalanceLabel.textContent =
        "Access request sent — the owner was emailed. Waiting for approve or deny.";
      cloudStatus.textContent = access.ownerEmail
        ? `Request pending · owner: ${access.ownerEmail}`
        : "Request pending.";
      return;
    }

    if (access?.accessStatus === "denied") {
      cloudBalanceLabel.textContent =
        "Owner denied access. Local .ninkkey still cannot unlock cloud-backed packages.";
      showAskOwnerControls("Ask owner again");
      return;
    }

    cloudBalanceLabel.textContent =
      `${creditLine} · You need owner approval before cloud unlock (even if you have the .ninkkey file).`;
    showAskOwnerControls("Ask owner for access");
  }

  async function handleAskOwner() {
    const loadedSession = viewer().getLoadedSession?.();
    viewer().clearError?.();
    cloudStatus.textContent = "Sending access request…";

    const stored = await readExtensionStorage(["ninkSession"]);
    if (!stored.ninkSession?.sessionToken) {
      const message = "Sign in with the NINK extension popup first, then click Ask owner again.";
      cloudStatus.textContent = message;
      viewer().showError?.(message);
      return;
    }

    try {
      const message = cloudAccessMessage?.value || "";
      const result = await callPackageApi("/v1/packages/request-access", loadedSession.packageId, {
        body: {
          packageId: loadedSession.packageId,
          message,
        },
      });
      cloudStatus.textContent = result.ownerEmail
        ? `Request sent · ${result.ownerEmail} was emailed to approve or deny.`
        : "Request sent · owner was emailed.";
      viewer().logStep?.(cloudStatus.textContent);
      if (cloudAccessMessage) {
        cloudAccessMessage.value = "";
      }
      await refreshCloudAccessPanel();
    } catch (error) {
      cloudStatus.textContent = error.message;
      viewer().showError?.(error.message);
    }
  }

  function setCloudActionButtonsEnabled(enabled) {
    cloudOpenBtn.disabled = !enabled;
    cloudVerifyBtn.disabled = !enabled;
    cloudReportBtn.disabled = !enabled;
  }

  async function fetchAccessStatus(packageId) {
    const stored = await readExtensionStorage(["ninkSession", "ninkConfig"]);
    const session = stored.ninkSession;
    if (!session?.sessionToken) {
      return null;
    }

    const apiBase = resolveApiBase(stored.ninkConfig || {});
    const response = await fetch(
      `${apiBase}/v1/packages/access-status?packageId=${encodeURIComponent(packageId)}`,
      {
        headers: { Authorization: `Bearer ${session.sessionToken}` },
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status === "ERROR") {
      return {
        accessStatus: "unknown",
        canUnlock: false,
        message: data.message || `Access status failed (${response.status})`,
      };
    }
    return data;
  }

  async function callPackageApi(path, packageId, options = {}) {
    const stored = await readExtensionStorage(["ninkSession", "ninkConfig"]);
    const session = stored.ninkSession;
    if (!session?.sessionToken) {
      throw new Error("Sign in with the NINK extension popup first.");
    }

    const apiBase = resolveApiBase(stored.ninkConfig || {});
    const response = await fetch(`${apiBase}${path}`, {
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify(options.body || { packageId }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === "ERROR") {
      throw new Error(payload.message || `Request failed (${response.status})`);
    }
    return payload;
  }

  async function updateStoredBalance(balanceWei) {
    const stored = await readExtensionStorage(["accounting"]);
    const accounting = stored.accounting || {};
    await new Promise((resolve) => {
      chrome.storage.local.set(
        {
          accounting: {
            ...accounting,
            userBalance: String(balanceWei),
            updatedAt: Date.now(),
          },
        },
        resolve
      );
    });
    await refreshCloudAccessPanel();
  }

  async function handleCloudOpen() {
    const loadedSession = viewer().getLoadedSession?.();
    viewer().clearError?.();
    cloudStatus.textContent = "Unlocking package…";
    try {
      const result = await callPackageApi("/v1/packages/view", loadedSession.packageId);
      if (result.balance) {
        await updateStoredBalance(result.balance);
      }
      viewer().renderConversation?.(result.payload);
      viewer().logStep?.(`Cloud open · ${result.creditsCharged || 10} credits charged`);
      cloudStatus.textContent = `Opened · ${result.creditsCharged || 10} credits charged · ${result.creditsRemaining ?? "—"} credits remaining`;
      cloudAccessPanel.classList.add("hidden");
    } catch (error) {
      cloudStatus.textContent = error.message;
      viewer().showError?.(error.message);
    }
  }

  async function handleCloudVerify() {
    const loadedSession = viewer().getLoadedSession?.();
    viewer().clearError?.();
    cloudStatus.textContent = "Verifying integrity…";
    try {
      const result = await callPackageApi("/v1/packages/verify", loadedSession.packageId);
      if (result.balance) {
        await updateStoredBalance(result.balance);
      }
      cloudStatus.textContent = result.valid
        ? `Valid · hash match confirmed · ${result.creditsCharged || 5} credits charged`
        : "Invalid · hash mismatch (no charge)";
      viewer().logStep?.(cloudStatus.textContent);
    } catch (error) {
      cloudStatus.textContent = error.message;
      viewer().showError?.(error.message);
    }
  }

  async function handleCloudReport() {
    const loadedSession = viewer().getLoadedSession?.();
    viewer().clearError?.();
    cloudStatus.textContent = "Generating report…";
    try {
      const result = await callPackageApi("/v1/packages/download-report", loadedSession.packageId);
      if (result.balance) {
        await updateStoredBalance(result.balance);
      }
      const blob = new Blob([JSON.stringify(result.report, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nink-report-${loadedSession.packageId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      cloudStatus.textContent = `Report downloaded · ${result.creditsCharged || 5} credits charged`;
      viewer().logStep?.(cloudStatus.textContent);
    } catch (error) {
      cloudStatus.textContent = error.message;
      viewer().showError?.(error.message);
    }
  }

  cloudOpenBtn.addEventListener("click", handleCloudOpen);
  cloudVerifyBtn.addEventListener("click", handleCloudVerify);
  cloudReportBtn.addEventListener("click", handleCloudReport);
  cloudAskOwnerBtn?.addEventListener("click", handleAskOwner);

  globalThis.__NINK_refreshCloudPanel__ = refreshCloudAccessPanel;
  loadPackageFees().then(refreshCloudAccessPanel);
})();
