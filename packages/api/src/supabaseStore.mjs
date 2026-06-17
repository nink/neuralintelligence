import { ANCHOR_FEE_WEI } from "./constants.mjs";
import { normalizeEmail } from "./store.mjs";
import { mapUserRow, requireSupabase } from "./supabaseClient.mjs";
import { supabaseLoginExistingUser } from "./signupStore.mjs";

export async function supabaseCreateOrLoginUser(email, password) {
  return supabaseLoginExistingUser(email, password);
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
