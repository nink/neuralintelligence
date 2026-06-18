import { createClient } from "@supabase/supabase-js";
import { INITIAL_USER_BALANCE_WEI } from "./constants.mjs";

export function requireSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when NINK_STORE=supabase.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function signupBonusWei() {
  return String(process.env.NINK_SIGNUP_BONUS_WEI || INITIAL_USER_BALANCE_WEI);
}

export function mapUserRow(row, balanceWei) {
  return {
    id: row.id,
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    balanceWei: String(balanceWei ?? "0"),
    rail: row.rail,
  };
}
