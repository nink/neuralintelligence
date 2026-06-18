-- Encrypted evidence packages (server-side AES-256-GCM) and generic virtual NINK debits

create table if not exists public.evidence_packages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.app_users (id) on delete cascade,
  title text not null,
  encrypted_payload text not null,
  payload_hash text not null,
  encryption_version text not null default 'aes-256-gcm-v1',
  state_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists evidence_packages_owner_id_idx
  on public.evidence_packages (owner_id, created_at desc);

create index if not exists evidence_packages_state_hash_idx
  on public.evidence_packages (state_hash);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  package_id uuid references public.evidence_packages (id) on delete set null,
  action text not null,
  amount integer not null check (amount > 0),
  amount_wei numeric(78, 0) not null,
  balance_after_wei numeric(78, 0) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_user_id_idx
  on public.credit_transactions (user_id, created_at desc);

alter table public.evidence_packages enable row level security;
alter table public.credit_transactions enable row level security;

-- Generic virtual NINK debit (anchor, package view, verify, report)
create or replace function public.debit_virtual_nink(
  p_user_id uuid,
  p_amount_wei numeric,
  p_entry_type text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_new_balance numeric;
  v_credits integer;
begin
  if p_amount_wei is null or p_amount_wei <= 0 then
    raise exception 'Invalid debit amount.';
  end if;

  if p_entry_type is null or length(trim(p_entry_type)) = 0 then
    raise exception 'entry_type is required.';
  end if;

  select balance_wei
  into v_balance
  from public.virtual_nink_balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'User balance not found.';
  end if;

  if v_balance < p_amount_wei then
    raise exception 'Insufficient NINK balance.';
  end if;

  v_new_balance := v_balance - p_amount_wei;
  v_credits := floor(p_amount_wei / 10000000000000000);

  update public.virtual_nink_balances
  set balance_wei = v_new_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.nink_ledger (
    user_id,
    entry_type,
    amount_wei,
    balance_after,
    metadata
  ) values (
    p_user_id,
    p_entry_type,
    -p_amount_wei,
    v_new_balance,
    coalesce(p_metadata, '{}'::jsonb)
  );

  insert into public.credit_transactions (
    user_id,
    package_id,
    action,
    amount,
    amount_wei,
    balance_after_wei,
    metadata
  ) values (
    p_user_id,
    nullif(p_metadata->>'package_id', '')::uuid,
    p_entry_type,
    greatest(v_credits, 1),
    p_amount_wei,
    v_new_balance,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'balance', v_new_balance::text,
    'credits', floor(v_new_balance / 10000000000000000),
    'entry_type', p_entry_type
  );
end;
$$;

-- Refund after failed decrypt/verify (does not delete original debit row)
create or replace function public.credit_virtual_nink(
  p_user_id uuid,
  p_amount_wei numeric,
  p_entry_type text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_new_balance numeric;
begin
  if p_amount_wei is null or p_amount_wei <= 0 then
    raise exception 'Invalid credit amount.';
  end if;

  select balance_wei
  into v_balance
  from public.virtual_nink_balances
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'User balance not found.';
  end if;

  v_new_balance := v_balance + p_amount_wei;

  update public.virtual_nink_balances
  set balance_wei = v_new_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.nink_ledger (
    user_id,
    entry_type,
    amount_wei,
    balance_after,
    metadata
  ) values (
    p_user_id,
    p_entry_type,
    p_amount_wei,
    v_new_balance,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'balance', v_new_balance::text,
    'credits', floor(v_new_balance / 10000000000000000)
  );
end;
$$;
