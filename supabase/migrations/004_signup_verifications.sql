-- Email verification codes for ni.nink.com signup (Resend)

create table if not exists public.signup_verifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now()
);

create index if not exists signup_verifications_email_created_idx
  on public.signup_verifications (email, created_at desc);

create index if not exists signup_verifications_expires_at_idx
  on public.signup_verifications (expires_at);

alter table public.signup_verifications enable row level security;
