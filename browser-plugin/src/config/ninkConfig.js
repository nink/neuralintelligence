export const DEFAULT_NINK_CONFIG = {
  useDevStubs: false,
  useWalletMode: false,
  /** false = production https://ni.nink.com · true = local http://127.0.0.1:8787 */
  useLocalApi: false,
  /** Cloud-backed .nink (has packageId) requires paid API unlock; disable only for dev/test. */
  strictCloudMode: true,
};
