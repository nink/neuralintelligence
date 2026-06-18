-- Owner-approved access grants for cloud evidence packages

create table if not exists public.package_access_requests (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.evidence_packages (id) on delete cascade,
  requester_id uuid not null references public.app_users (id) on delete cascade,
  owner_id uuid not null references public.app_users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  requester_message text,
  approve_token_hash text not null,
  deny_token_hash text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists package_access_requests_one_pending_idx
  on public.package_access_requests (package_id, requester_id)
  where status = 'pending';

create index if not exists package_access_requests_owner_status_idx
  on public.package_access_requests (owner_id, status, created_at desc);

create index if not exists package_access_requests_requester_idx
  on public.package_access_requests (requester_id, package_id, created_at desc);

create table if not exists public.package_access_grants (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.evidence_packages (id) on delete cascade,
  granted_to_user_id uuid not null references public.app_users (id) on delete cascade,
  granted_by_user_id uuid not null references public.app_users (id) on delete cascade,
  request_id uuid references public.package_access_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (package_id, granted_to_user_id)
);

create index if not exists package_access_grants_user_idx
  on public.package_access_grants (granted_to_user_id, package_id);

alter table public.package_access_requests enable row level security;
alter table public.package_access_grants enable row level security;
