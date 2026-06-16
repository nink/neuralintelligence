export function normalizeStateHashHex(stateHashHex) {
  const normalized = String(stateHashHex || "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("State hash must be a 64-character SHA-256 hex string.");
  }

  return `0x${normalized}`;
}
