export const TOKEN_DECIMALS = 18;
export const TOKEN_DECIMALS_BI = 18n;
export const TOKEN_SCALE = 10n ** TOKEN_DECIMALS_BI;

/** Matches Rail 1 signup bonus (5.00 NINK) and anchor fee (0.01 NINK). */
export const MOCK_BALANCE_WEI = (5n * TOKEN_SCALE).toString();
export const MOCK_FEE_WEI = (10n ** 16n).toString();

export const LOCAL_DEV_ACCOUNTING = {
  balance: MOCK_BALANCE_WEI,
  feeRequirement: MOCK_FEE_WEI,
  source: "local-dev-fallback",
  isLocalDevMode: true,
};

/** Demo balance when api.nink.network is unreachable but user is signed in. */
export const STUB_ACCOUNT_ACCOUNTING = {
  balance: MOCK_BALANCE_WEI,
  feeRequirement: MOCK_FEE_WEI,
  source: "nink-account-stub-fallback",
  isLocalDevMode: false,
};

export function createMockAnchorReceipt() {
  const txHash =
    "0x" +
    Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");

  return {
    status: "MOCK_SUCCESS",
    txHash,
    source: "local-dev-fallback",
    isLocalDevMode: true,
  };
}
