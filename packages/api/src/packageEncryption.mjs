import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
export const ENCRYPTION_VERSION = "aes-256-gcm-v1";
const IV_LENGTH = 12;

function resolveMasterKey() {
  const raw = process.env.NINK_PACKAGE_MASTER_KEY;
  if (!raw) {
    throw new Error("NINK_PACKAGE_MASTER_KEY is not configured.");
  }

  const trimmed = String(raw).trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== 32) {
    throw new Error("NINK_PACKAGE_MASTER_KEY must be 32 bytes (hex or base64).");
  }

  return decoded;
}

export function hashPayload(payload) {
  const json = JSON.stringify(payload);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

export function encryptPayload(payload) {
  const key = resolveMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope = {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };

  return {
    encryptedPayload: JSON.stringify(envelope),
    payloadHash: hashPayload(payload),
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

export function decryptPayload(stored) {
  const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
  const key = resolveMasterKey();
  const iv = Buffer.from(parsed.iv, "base64");
  const ciphertext = Buffer.from(parsed.ciphertext, "base64");
  const authTag = Buffer.from(parsed.authTag, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const payload = JSON.parse(plaintext.toString("utf8"));

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Decrypted package was not a valid object.");
  }

  return payload;
}
