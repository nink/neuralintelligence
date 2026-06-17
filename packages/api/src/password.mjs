import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export function hashPassword(plainPassword) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(plainPassword), salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash) {
    return false;
  }

  const parts = String(storedHash).split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(String(plainPassword), salt, expected.length, SCRYPT_OPTIONS);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}
