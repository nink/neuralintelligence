export const TOKEN_DECIMALS = 18;
export const TOKEN_DECIMALS_BI = 18n;
export const TOKEN_SCALE = 10n ** TOKEN_DECIMALS_BI;
/** 1 credit = 0.01 NINK. Display layer only — balances stay in wei internally. */
export const CREDIT_WEI = 10n ** 16n;
export const CREDITS_PER_NINK = 100n;

export function parseTokenAmount(value) {
  const normalized = String(value ?? "0").trim();
  if (!normalized) {
    return 0n;
  }

  if (/^\d+$/.test(normalized)) {
    return BigInt(normalized);
  }

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    const [wholePart = "0", fractionPart = ""] = normalized.split(".");
    const fraction = (fractionPart + "0".repeat(TOKEN_DECIMALS)).slice(
      0,
      TOKEN_DECIMALS
    );
    return BigInt(`${wholePart}${fraction}`);
  }

  return null;
}

export function weiToCredits(wei) {
  const units = parseTokenAmount(wei);
  if (units === null) {
    return 0;
  }
  return Number(units / CREDIT_WEI);
}

export function formatCreditsForDisplay(wei) {
  const credits = weiToCredits(wei);
  return `${credits} credits`;
}

export function formatSignOffButtonLabel(feeWei) {
  const credits = weiToCredits(feeWei);
  return credits > 0 ? `Sign Off ${credits} Credits` : "Sign Off";
}

export function resolveViewerOpenCredits(accounting) {
  if (!accounting) {
    return null;
  }
  if (accounting.packageFees?.view?.credits != null) {
    return accounting.packageFees.view.credits;
  }
  if (accounting.feeCredits != null) {
    return accounting.feeCredits;
  }
  if (accounting.requiredFee) {
    return weiToCredits(accounting.requiredFee);
  }
  return null;
}

export function formatViewerButtonLabel(accounting) {
  const credits = resolveViewerOpenCredits(accounting);
  return credits != null ? `Open Viewer · ${credits} Credits` : "Open Session Viewer";
}

export function compareTokenAmounts(left, right) {
  const leftUnits = parseTokenAmount(left);
  const rightUnits = parseTokenAmount(right);

  if (leftUnits === null || rightUnits === null) {
    return Number.parseFloat(left) - Number.parseFloat(right);
  }

  if (leftUnits === rightUnits) {
    return 0;
  }

  return leftUnits > rightUnits ? 1 : -1;
}

export function hasSufficientBalance(balance, cost) {
  return compareTokenAmounts(balance, cost) >= 0;
}

export function formatTokenForDisplay(value, fractionDigits = 2) {
  const units = parseTokenAmount(value);
  if (units === null) {
    return String(value ?? "0");
  }

  const scale = 10n ** BigInt(TOKEN_DECIMALS);
  const whole = units / scale;
  const fraction = units % scale;

  if (fractionDigits <= 0) {
    return whole.toString();
  }

  const multiplier = 10n ** BigInt(fractionDigits);
  const displayedFraction = (fraction * multiplier) / scale;
  return `${whole}.${displayedFraction.toString().padStart(fractionDigits, "0")}`;
}
