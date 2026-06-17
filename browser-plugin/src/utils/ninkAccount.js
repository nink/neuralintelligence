export function normalizeAccountEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidStubEmail(email) {
  const normalized = normalizeAccountEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function buildStubSession(email) {
  const userId = normalizeAccountEmail(email);

  return {
    userId,
    email: userId,
    displayName: userId.split("@")[0] || "user",
    loggedInAt: new Date().toISOString(),
    stub: true,
  };
}

export function formatAccountLabel(session) {
  if (!session?.email) {
    return "Not signed in";
  }
  return `Signed in as ${session.email}`;
}

export async function readLastLoginEmail() {
  const stored = await chrome.storage.local.get("lastLoginEmail");
  return stored.lastLoginEmail ? normalizeAccountEmail(stored.lastLoginEmail) : "";
}

export async function saveLastLoginEmail(email) {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) {
    return;
  }
  await chrome.storage.local.set({ lastLoginEmail: normalized });
}

export function isCloudAccounting(accounting) {
  const source = String(accounting?.source || "");
  return source === "nink-cloud-api" || source === "production-api";
}

/** Demo / local-dev balances — not authoritative for ni.nink.com. */
export function isDemoAccounting(accounting) {
  if (!accounting) {
    return false;
  }
  if (isCloudAccounting(accounting)) {
    return false;
  }
  if (accounting.isLocalDevMode) {
    return true;
  }
  const source = String(accounting.source || "");
  return (
    source.includes("stub") ||
    source.includes("local-dev") ||
    source.includes("fallback") ||
    source === "unknown"
  );
}
