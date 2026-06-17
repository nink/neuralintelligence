#!/usr/bin/env node
/**
 * Set or backfill app_users.password_hash (Rail 1).
 *
 *   node scripts/set-user-password.mjs peter@nink.com 1234
 *   node scripts/set-user-password.mjs --legacy-default 1234
 */
import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "../src/password.mjs";
import { normalizeEmail } from "../src/store.mjs";
import { loadLocalEnv, localEnvPath } from "./loadEnv.mjs";

loadLocalEnv();

function requireSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      `Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy packages/api/.env.example to .env and paste your service role key. Expected file: ${localEnvPath()}`
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function setPasswordForEmail(email, plainPassword) {
  const supabase = requireSupabase();
  const normalized = normalizeEmail(email);
  const passwordHash = hashPassword(plainPassword);

  const { data, error } = await supabase
    .from("app_users")
    .update({ password_hash: passwordHash })
    .eq("email", normalized)
    .select("email")
    .maybeSingle();

  if (error) {
    if (/invalid api key/i.test(error.message)) {
      throw new Error(
        "Supabase rejected the API key. Use the service_role key (not anon) in packages/api/.env — Supabase Dashboard → Project Settings → API."
      );
    }
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error(`No user found for ${normalized}`);
  }

  console.log(`Password updated for ${data.email}`);
}

async function setLegacyDefaultPassword(plainPassword) {
  const supabase = requireSupabase();
  const passwordHash = hashPassword(plainPassword);

  const { data: rows, error: selectError } = await supabase
    .from("app_users")
    .select("id, email")
    .is("password_hash", null);

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (!rows?.length) {
    console.log("No legacy users without password_hash.");
    return;
  }

  for (const row of rows) {
    const { error } = await supabase
      .from("app_users")
      .update({ password_hash: passwordHash })
      .eq("id", row.id);
    if (error) {
      throw new Error(`${row.email}: ${error.message}`);
    }
    console.log(`Password set for ${row.email}`);
  }
}

const [arg1, arg2, arg3] = process.argv.slice(2);

if (arg1 === "--legacy-default" && arg2) {
  await setLegacyDefaultPassword(arg2);
} else if (arg1 && arg2) {
  await setPasswordForEmail(arg1, arg2);
} else {
  console.error("Usage:");
  console.error("  node scripts/set-user-password.mjs <email> <password>");
  console.error("  node scripts/set-user-password.mjs --legacy-default <password>");
  process.exit(1);
}
