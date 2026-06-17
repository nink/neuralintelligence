import { randomUUID } from "node:crypto";
import { createHash, randomInt } from "node:crypto";
import { ANCHOR_FEE_WEI, SESSION_TTL_MS } from "./constants.mjs";
import {
  assertPasswordStrength,
  hashPassword,
  InvalidCredentialsError,
  verifyPassword,
} from "./password.mjs";
import { isValidEmail, normalizeEmail } from "./store.mjs";
import { sendSignupVerificationEmail } from "./resend.mjs";
import { mapUserRow, requireSupabase, signupBonusWei } from "./supabaseClient.mjs";

const SIGNUP_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const SEND_COOLDOWN_MS = 60 * 1000;

function codePepper() {
  return process.env.SIGNUP_CODE_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev-signup-pepper";
}

export function generateVerificationCode() {
  return String(randomInt(100000, 999999));
}

export function hashVerificationCode(email, code) {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${String(code).trim()}:${codePepper()}`)
    .digest("hex");
}

export class SignupConflictError extends Error {
  constructor(message = "An account with this email already exists. Sign in instead.") {
    super(message);
    this.name = "SignupConflictError";
  }
}

export class SignupVerificationError extends Error {
  constructor(message = "Invalid or expired verification code.") {
    super(message);
    this.name = "SignupVerificationError";
  }
}

export async function supabaseEmailExists(email) {
  const supabase = requireSupabase();
  const normalized = normalizeEmail(email);
  const row = await supabase.from("app_users").select("id").eq("email", normalized).maybeSingle();
  if (row.error) {
    throw new Error(row.error.message);
  }
  return Boolean(row.data);
}

export async function supabaseSendSignupVerification(email) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Enter a valid email address.");
  }

  if (await supabaseEmailExists(normalized)) {
    throw new SignupConflictError();
  }

  const supabase = requireSupabase();
  const recent = await supabase
    .from("signup_verifications")
    .select("created_at")
    .eq("email", normalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent.error) {
    throw new Error(recent.error.message);
  }

  if (recent.data && Date.now() - Date.parse(recent.data.created_at) < SEND_COOLDOWN_MS) {
    throw new Error("Please wait a minute before requesting another code.");
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + SIGNUP_CODE_TTL_MS).toISOString();

  const insert = await supabase.from("signup_verifications").insert({
    email: normalized,
    code_hash: hashVerificationCode(normalized, code),
    expires_at: expiresAt,
  });

  if (insert.error) {
    throw new Error(insert.error.message);
  }

  await sendSignupVerificationEmail({ email: normalized, code });

  return {
    email: normalized,
    expiresAt,
    message: "Verification code sent. Check your inbox.",
  };
}

async function createVerifiedUser(normalized, plainPassword) {
  const supabase = requireSupabase();
  const displayName = normalized.split("@")[0] || "user";
  const passwordHash = hashPassword(plainPassword);

  const insertUser = await supabase
    .from("app_users")
    .insert({
      email: normalized,
      display_name: displayName,
      rail: "closed_loop",
      password_hash: passwordHash,
    })
    .select("id, email, display_name, rail")
    .single();

  if (insertUser.error) {
    throw new Error(insertUser.error.message);
  }

  const userRow = insertUser.data;
  const bonus = signupBonusWei();

  const insertBalance = await supabase.from("virtual_nink_balances").insert({
    user_id: userRow.id,
    balance_wei: bonus,
  });

  if (insertBalance.error) {
    throw new Error(insertBalance.error.message);
  }

  await supabase.from("nink_ledger").insert({
    user_id: userRow.id,
    entry_type: "signup_bonus",
    amount_wei: bonus,
    balance_after: bonus,
    metadata: { reason: "email_verified_signup" },
  });

  return userRow;
}

export async function supabaseCompleteSignup(email, code, password) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Enter a valid email address.");
  }

  assertPasswordStrength(password);

  if (await supabaseEmailExists(normalized)) {
    throw new SignupConflictError();
  }

  const supabase = requireSupabase();
  const pending = await supabase
    .from("signup_verifications")
    .select("id, code_hash, expires_at, consumed_at, attempts")
    .eq("email", normalized)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pending.error) {
    throw new Error(pending.error.message);
  }

  if (!pending.data) {
    throw new SignupVerificationError("No active verification code. Request a new one.");
  }

  if (Date.parse(pending.data.expires_at) <= Date.now()) {
    throw new SignupVerificationError("Verification code expired. Request a new one.");
  }

  if (pending.data.attempts >= MAX_VERIFY_ATTEMPTS) {
    throw new SignupVerificationError("Too many attempts. Request a new code.");
  }

  const codeOk = hashVerificationCode(normalized, code) === pending.data.code_hash;

  await supabase
    .from("signup_verifications")
    .update({ attempts: pending.data.attempts + 1 })
    .eq("id", pending.data.id);

  if (!codeOk) {
    throw new SignupVerificationError("Incorrect verification code.");
  }

  const userRow = await createVerifiedUser(normalized, password);

  await supabase
    .from("signup_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", pending.data.id);

  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const sessionInsert = await supabase.from("api_sessions").insert({
    token: sessionToken,
    user_id: userRow.id,
    expires_at: expiresAt,
  });

  if (sessionInsert.error) {
    throw new Error(sessionInsert.error.message);
  }

  const balanceRow = await supabase
    .from("virtual_nink_balances")
    .select("balance_wei")
    .eq("user_id", userRow.id)
    .single();

  if (balanceRow.error) {
    throw new Error(balanceRow.error.message);
  }

  const user = mapUserRow(userRow, balanceRow.data.balance_wei);
  return {
    user,
    sessionToken,
    expiresAt,
    balance: user.balanceWei,
    feeRequirement: ANCHOR_FEE_WEI,
    signupBonusWei: signupBonusWei(),
  };
}

export async function supabaseLoginExistingUser(email, password) {
  const supabase = requireSupabase();
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Enter a valid email address.");
  }

  const plainPassword = String(password ?? "");
  if (!plainPassword) {
    throw new InvalidCredentialsError();
  }

  const userRow = await supabase
    .from("app_users")
    .select("id, email, display_name, rail, password_hash")
    .eq("email", normalized)
    .maybeSingle();

  if (userRow.error) {
    throw new Error(userRow.error.message);
  }

  if (!userRow.data) {
    throw new InvalidCredentialsError();
  }

  if (!userRow.data.password_hash) {
    throw new Error("Password not set for this account. Complete signup or contact support.");
  }

  if (!verifyPassword(plainPassword, userRow.data.password_hash)) {
    throw new InvalidCredentialsError();
  }

  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const sessionInsert = await supabase.from("api_sessions").insert({
    token: sessionToken,
    user_id: userRow.data.id,
    expires_at: expiresAt,
  });

  if (sessionInsert.error) {
    throw new Error(sessionInsert.error.message);
  }

  const balanceRow = await supabase
    .from("virtual_nink_balances")
    .select("balance_wei")
    .eq("user_id", userRow.data.id)
    .single();

  if (balanceRow.error) {
    throw new Error(balanceRow.error.message);
  }

  const user = mapUserRow(userRow.data, balanceRow.data.balance_wei);
  return { user, sessionToken, expiresAt };
}
