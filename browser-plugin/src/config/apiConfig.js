export const NINK_API_CONFIG = {
  productionBaseUrl: "https://api.nink.network",
  localDevBaseUrl: "http://127.0.0.1:8787",
};

export function resolveApiBaseUrl(config = {}) {
  if (config.apiBaseUrl) {
    return String(config.apiBaseUrl).replace(/\/$/, "");
  }

  if (config.useLocalApi !== false) {
    return NINK_API_CONFIG.localDevBaseUrl;
  }

  return NINK_API_CONFIG.productionBaseUrl;
}
