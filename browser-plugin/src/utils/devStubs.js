export const TOKEN_DECIMALS = 18;
export const TOKEN_DECIMALS_BI = 18n;
export const TOKEN_SCALE = 10n ** TOKEN_DECIMALS_BI;

export const MOCK_BALANCE_WEI = (100n * TOKEN_SCALE).toString();
export const MOCK_FEE_WEI = (5n * (10n ** 14n)).toString();

export const LOCAL_DEV_ACCOUNTING = {
  balance: MOCK_BALANCE_WEI,
  feeRequirement: MOCK_FEE_WEI,
  source: "local-dev-fallback",
  isLocalDevMode: true,
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
