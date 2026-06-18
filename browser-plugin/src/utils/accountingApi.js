import { DEFAULT_NINK_CONFIG } from "../config/ninkConfig.js";
import { resolveApiBaseUrl } from "../config/apiConfig.js";
import { isCloudAccounting } from "./ninkAccount.js";
import { parseTokenAmount } from "./tokenMath.js";

const RECENT_ANCHOR_MS = 10 * 60 * 1000;

export function shouldRejectStaleBalanceIncrease(current, nextAccounting, options = {}) {
  if (options.force) {
    return false;
  }
  if (!current || !isCloudAccounting(current)) {
    return false;
  }

  const currentUnits = parseTokenAmount(current.userBalance);
  const nextUnits = parseTokenAmount(nextAccounting.userBalance);
  if (currentUnits == null || nextUnits == null || nextUnits <= currentUnits) {
    return false;
  }

  const anchorAt = current.lastAnchorAt ?? current.updatedAt;
  if (!anchorAt) {
    return false;
  }

  return Date.now() - anchorAt < RECENT_ANCHOR_MS;
}

export async function fetchCloudAccountingParameters(config = {}, session) {
  const mergedConfig = { ...DEFAULT_NINK_CONFIG, ...config };

  if (!session?.sessionToken) {
    throw new Error("Session expired. Sign out, then sign in again.");
  }

  const apiBase = resolveApiBaseUrl(mergedConfig);
  const accountingUrl = `${apiBase}/v1/accounting/parameters?user=${encodeURIComponent(session.userId)}`;

  const response = await fetch(accountingUrl, {
    headers: {
      Authorization: `Bearer ${session.sessionToken}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Accounting API returned ${response.status}`);
  }

  return {
    userBalance: String(data.balance),
    requiredFee: String(data.feeRequirement),
    balanceCredits: data.balanceCredits,
    feeCredits: data.feeCredits,
    packageFees: data.packageFees,
    source: data.source || "nink-cloud-api",
    isLocalDevMode: false,
  };
}

export async function writeAccountingToStorage(accounting, options = {}) {
  const next = {
    ...accounting,
    updatedAt: accounting.updatedAt ?? Date.now(),
  };

  if (!options.force) {
    const latest = await chrome.storage.local.get("accounting");
    const current = latest.accounting;

    if (shouldRejectStaleBalanceIncrease(current, next, options)) {
      return current;
    }

    if (
      options.fetchStartedAt != null &&
      current?.updatedAt &&
      current.updatedAt > options.fetchStartedAt &&
      isCloudAccounting(current)
    ) {
      return current;
    }
  }

  await chrome.storage.local.set({ accounting: next });
  await chrome.storage.local.remove("accountingError");
  return next;
}

export async function applyBalanceAfterAnchor(balanceAfter, requiredFee, source = "nink-cloud-api") {
  const now = Date.now();
  return writeAccountingToStorage(
    {
      userBalance: String(balanceAfter),
      requiredFee: String(requiredFee),
      source,
      isLocalDevMode: source === "local-dev-stubs",
      updatedAt: now,
      lastAnchorAt: now,
    },
    { force: true }
  );
}

export async function anchorOnCloudApi(config, session, stateHash, appliedFee) {
  if (!session?.sessionToken) {
    throw new Error("Session expired. Sign out, then sign in again.");
  }

  const apiBase = resolveApiBaseUrl({ ...DEFAULT_NINK_CONFIG, ...config });
  const response = await fetch(`${apiBase}/v1/blockchain/anchor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.sessionToken}`,
    },
    body: JSON.stringify({
      stateHash,
      tokenFeeBurned: String(appliedFee),
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.status === "ERROR") {
    throw new Error(payload.message || `Anchor API returned ${response.status}`);
  }

  if (payload.balance == null) {
    throw new Error("Anchor succeeded but balance was not returned.");
  }

  return payload;
}

export async function uploadCloudPackage(config, session, payload, stateHash, title) {
  if (!session?.sessionToken) {
    throw new Error("Session expired.");
  }

  const apiBase = resolveApiBaseUrl({ ...DEFAULT_NINK_CONFIG, ...config });
  const response = await fetch(`${apiBase}/v1/packages/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.sessionToken}`,
    },
    body: JSON.stringify({
      title,
      payload,
      stateHash,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === "ERROR") {
    throw new Error(data.message || `Package create returned ${response.status}`);
  }

  return data.packageId;
}

export async function syncCloudAccountingAfterAnchor(config, session, requiredFee) {
  const accounting = await fetchCloudAccountingParameters(config, session);
  return applyBalanceAfterAnchor(accounting.userBalance, requiredFee);
}
