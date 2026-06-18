-- Append-only audit log for cloud package access attempts and owner workflow

create table if not exists public.package_access_events (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.evidence_packages (id) on delete cascade,
  actor_user_id uuid references public.app_users (id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists package_access_events_package_idx
  on public.package_access_events (package_id, created_at desc);

create index if not exists package_access_events_actor_idx
  on public.package_access_events (actor_user_id, created_at desc);

alter table public.package_access_events enable row level security;
