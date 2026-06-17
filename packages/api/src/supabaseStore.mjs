import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  ANCHOR_FEE_WEI,
  INITIAL_USER_BALANCE_WEI,
  SESSION_TTL_MS,
} from "./constants.mjs";
import { isValidEmail, normalizeEmail } from "./store.mjs";

function requireSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when NINK_STORE=supabase.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function signupBonusWei() {
  return String(process.env.NINK_SIGNUP_BONUS_WEI || INITIAL_USER_BALANCE_WEI);
}

function mapUserRow(row, balanceWei) {
  return {
    id: row.id,
    userId: row.email,
    email: row.email,
    displayName: row.display_name,
    balanceWei: String(balanceWei ?? "0"),
    rail: row.rail,
  };
}

export async function supabaseCreateOrLoginUser(email) {
  const supabase = requireSupabase();
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error("Enter a valid email address.");
  }

  const displayName = normalized.split("@")[0] || "user";

  let { data: userRow, error: userError } = await supabase
    .from("app_users")
    .select("id, email, display_name, rail")
    .eq("email", normalized)
    .maybeSingle();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!userRow) {
    const insertUser = await supabase
      .from("app_users")
      .insert({
        email: normalized,
        display_name: displayName,
        rail: "closed_loop",
      })
      .select("id, email, display_name, rail")
      .single();

    if (insertUser.error) {
      throw new Error(insertUser.error.message);
    }

    userRow = insertUser.data;

    const insertBalance = await supabase.from("virtual_nink_balances").insert({
      user_id: userRow.id,
      balance_wei: signupBonusWei(),
    });

    if (insertBalance.error) {
      throw new Error(insertBalance.error.message);
    }

    await supabase.from("nink_ledger").insert({
      user_id: userRow.id,
      entry_type: "signup_bonus",
      amount_wei: signupBonusWei(),
      balance_after: signupBonusWei(),
      metadata: { reason: "new_account" },
    });
  }

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
  return { user, sessionToken, expiresAt };
}

async function loadUserByInternalId(userId) {
  const supabase = requireSupabase();
  const userRow = await supabase
    .from("app_users")
    .select("id, email, display_name, rail")
    .eq("id", userId)
    .maybeSingle();

  if (userRow.error || !userRow.data) {
    return null;
  }

  const balanceRow = await supabase
    .from("virtual_nink_balances")
    .select("balance_wei")
    .eq("user_id", userId)
    .maybeSingle();

  if (balanceRow.error || !balanceRow.data) {
    return null;
  }

  return mapUserRow(userRow.data, balanceRow.data.balance_wei);
}

export async function supabaseGetUserByToken(token) {
  if (!token) {
    return null;
  }

  const supabase = requireSupabase();
  const sessionRow = await supabase
    .from("api_sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (sessionRow.error || !sessionRow.data) {
    return null;
  }

  if (Date.parse(sessionRow.data.expires_at) <= Date.now()) {
    await supabase.from("api_sessions").delete().eq("token", token);
    return null;
  }

  return loadUserByInternalId(sessionRow.data.user_id);
}

export async function supabaseGetUserByEmail(email) {
  const supabase = requireSupabase();
  const normalized = normalizeEmail(email);
  const userRow = await supabase
    .from("app_users")
    .select("id, email, display_name, rail")
    .eq("email", normalized)
    .maybeSingle();

  if (userRow.error || !userRow.data) {
    return null;
  }

  const balanceRow = await supabase
    .from("virtual_nink_balances")
    .select("balance_wei")
    .eq("user_id", userRow.data.id)
    .maybeSingle();

  if (balanceRow.error || !balanceRow.data) {
    return null;
  }

  return mapUserRow(userRow.data, balanceRow.data.balance_wei);
}

export async function supabaseDebitVirtualAnchor(user, stateHash, feeWei = ANCHOR_FEE_WEI) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("debit_virtual_nink_anchor", {
    p_user_id: user.id,
    p_state_hash: String(stateHash),
    p_fee_wei: String(feeWei),
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    balance: data.balance,
    proofId: data.proof_id,
    feePaid: data.fee_paid,
    stateHash: data.state_hash,
    rail: data.rail,
    source: data.source,
    onChain: false,
    txHash: null,
    blockNumber: null,
  };
}

export async function supabaseHealthCheck() {
  const supabase = requireSupabase();
  const { error } = await supabase.from("app_users").select("id").limit(1);
  if (error) {
    throw new Error(error.message);
  }
  return { ready: true, store: "supabase" };
}
