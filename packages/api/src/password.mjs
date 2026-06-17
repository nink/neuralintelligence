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

export class PasswordValidationError extends Error {
  constructor(messages) {
    super(messages.join(" "));
    this.name = "PasswordValidationError";
    this.messages = messages;
  }
}

/** Standard signup password rules (client should mirror for UX). */
export function validatePasswordStrength(password) {
  const value = String(password ?? "");
  const messages = [];

  if (value.length < 8) {
    messages.push("At least 8 characters.");
  }
  if (value.length > 128) {
    messages.push("At most 128 characters.");
  }
  if (!/[a-z]/.test(value)) {
    messages.push("At least one lowercase letter.");
  }
  if (!/[A-Z]/.test(value)) {
    messages.push("At least one uppercase letter.");
  }
  if (!/[0-9]/.test(value)) {
    messages.push("At least one number.");
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    messages.push("At least one symbol (e.g. ! @ # $).");
  }

  return messages;
}

export function assertPasswordStrength(password) {
  const messages = validatePasswordStrength(password);
  if (messages.length) {
    throw new PasswordValidationError(messages);
  }
}
