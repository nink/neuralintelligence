export const TOKEN_DECIMALS = 18;

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

export function formatTokenForDisplay(value, fractionDigits = 4) {
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
