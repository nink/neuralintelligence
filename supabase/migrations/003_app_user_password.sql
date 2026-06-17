-- Per-user password hashes (scrypt, verified in packages/api)
alter table public.app_users
  add column if not exists password_hash text;

comment on column public.app_users.password_hash is
  'scrypt:salt:hash — set via signup or scripts/set-user-password.mjs';

-- Legacy accounts (created before password column): run once in Supabase SQL Editor
-- AFTER generating a hash:
--   cd packages/api && node scripts/set-user-password.mjs peter@nink.com 1234
-- Or backfill every account still missing a hash:
--   node scripts/set-user-password.mjs --legacy-default 1234
