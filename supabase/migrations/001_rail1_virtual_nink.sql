-- Rail 1: virtual NINK (closed-loop ledger)
-- Run in Supabase Dashboard → SQL Editor (project gggceicesawwbvmkioig)

create extension if not exists "pgcrypto";

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  rail text not null default 'closed_loop',
  created_at timestamptz not null default now()
);

create table if not exists public.virtual_nink_balances (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  balance_wei numeric(78, 0) not null default 0 check (balance_wei >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.api_sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists api_sessions_user_id_idx on public.api_sessions (user_id);
create index if not exists api_sessions_expires_at_idx on public.api_sessions (expires_at);

create table if not exists public.nink_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  entry_type text not null,
  amount_wei numeric(78, 0) not null,
  balance_after numeric(78, 0) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists nink_ledger_user_id_idx on public.nink_ledger (user_id, created_at desc);

create table if not exists public.anchor_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  state_hash text not null,
  fee_wei numeric(78, 0) not null,
  proof_id uuid not null default gen_random_uuid(),
  rail text not null default 'virtual',
  tx_hash text,
  block_number bigint,
  source text not null default 'nink-cloud-api',
  created_at timestamptz not null default now()
);

create index if not exists anchor_events_user_id_idx on public.anchor_events (user_id, created_at desc);
create unique index if not exists anchor_events_state_hash_idx on public.anchor_events (state_hash);

-- Atomic virtual NINK debit for sign-off (Rail 1)
create or replace function public.debit_virtual_nink_anchor(
  p_user_id uuid,
  p_state_hash text,
  p_fee_wei numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_new_balance numeric;
  v_proof_id uuid;
begin
  if p_state_hash is null or length(trim(p_state_hash)) = 0 then
    raise exception 'stateHash is required.';
  end if;

  if p_fee_wei is null or p_fee_wei <= 0 then
    raise exception 'Invalid anchor fee.';
  end if;

  select balance_wei
  into v_balance
  from public.virtual_nink_balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'User balance not found.';
  end if;

  if v_balance < p_fee_wei then
    raise exception 'Insufficient NINK balance for anchor fee.';
  end if;

  v_new_balance := v_balance - p_fee_wei;
  v_proof_id := gen_random_uuid();

  update public.virtual_nink_balances
  set balance_wei = v_new_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.anchor_events (
    user_id,
    state_hash,
    fee_wei,
    proof_id,
    rail,
    source
  ) values (
    p_user_id,
    p_state_hash,
    p_fee_wei,
    v_proof_id,
    'virtual',
    'nink-cloud-api'
  );

  insert into public.nink_ledger (
    user_id,
    entry_type,
    amount_wei,
    balance_after,
    metadata
  ) values (
    p_user_id,
    'debit_anchor',
    -p_fee_wei,
    v_new_balance,
    jsonb_build_object(
      'state_hash', p_state_hash,
      'proof_id', v_proof_id
    )
  );

  return jsonb_build_object(
    'balance', v_new_balance::text,
    'proof_id', v_proof_id::text,
    'fee_paid', p_fee_wei::text,
    'state_hash', p_state_hash,
    'rail', 'virtual',
    'source', 'nink-cloud-api'
  );
end;
$$;

-- RLS: service role bypasses; anon has no access (API uses service role only)
alter table public.app_users enable row level security;
alter table public.virtual_nink_balances enable row level security;
alter table public.api_sessions enable row level security;
alter table public.nink_ledger enable row level security;
alter table public.anchor_events enable row level security;
