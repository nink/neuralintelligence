/** Production default: cloud-backed packages require paid API unlock. */
export const DEFAULT_STRICT_CLOUD_MODE = true;

export function isStrictCloudModeEnabled(config = {}) {
  if (typeof config.strictCloudMode === "boolean") {
    return config.strictCloudMode;
  }
  return DEFAULT_STRICT_CLOUD_MODE;
}

export function requiresCloudUnlock(session, config = {}) {
  return Boolean(session?.packageId) && isStrictCloudModeEnabled(config);
}

export function isLocalOnlyPackage(session) {
  return !session?.packageId;
}

export function parseNinkPackageId(ninkText) {
  if (!ninkText) {
    return null;
  }

  try {
    const parsed = JSON.parse(ninkText);
    return parsed?.packageId ? String(parsed.packageId) : null;
  } catch (_error) {
    return null;
  }
}
