(function initNinkStrictCloudMode() {
  const DEFAULT_STRICT_CLOUD_MODE = true;

  function isStrictCloudModeEnabled(config) {
    if (config && typeof config.strictCloudMode === "boolean") {
      return config.strictCloudMode;
    }
    return DEFAULT_STRICT_CLOUD_MODE;
  }

  function requiresCloudUnlock(session, config) {
    return Boolean(session?.packageId) && isStrictCloudModeEnabled(config);
  }

  function isLocalOnlyPackage(session) {
    return !session?.packageId;
  }

  globalThis.__NINK_STRICT_CLOUD__ = {
    DEFAULT_STRICT_CLOUD_MODE,
    isStrictCloudModeEnabled,
    requiresCloudUnlock,
    isLocalOnlyPackage,
  };
})();
