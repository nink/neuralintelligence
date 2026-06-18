import {
  ANCHOR_FEE_WEI,
  CREDIT_WEI,
  CREDITS_PER_NINK,
  PACKAGE_REPORT_FEE_WEI,
  PACKAGE_VERIFY_FEE_WEI,
  PACKAGE_VIEW_FEE_WEI,
} from "./constants.mjs";

export function weiToCredits(wei) {
  const value = BigInt(String(wei ?? "0"));
  return Number(value / CREDIT_WEI);
}

export function creditsToWei(credits) {
  return (BigInt(credits) * CREDIT_WEI).toString();
}

export function formatCreditsSummary(wei) {
  const credits = weiToCredits(wei);
  return {
    credits,
    creditsLabel: `${credits} credits`,
    ninkLabel: `${(Number(wei) / Number(CREDITS_PER_NINK * CREDIT_WEI)).toFixed(2)} NINK`,
  };
}

export const PACKAGE_FEES = {
  view: { wei: PACKAGE_VIEW_FEE_WEI, credits: weiToCredits(PACKAGE_VIEW_FEE_WEI) },
  verify: { wei: PACKAGE_VERIFY_FEE_WEI, credits: weiToCredits(PACKAGE_VERIFY_FEE_WEI) },
  report: { wei: PACKAGE_REPORT_FEE_WEI, credits: weiToCredits(PACKAGE_REPORT_FEE_WEI) },
  anchor: { wei: ANCHOR_FEE_WEI, credits: weiToCredits(ANCHOR_FEE_WEI) },
};
