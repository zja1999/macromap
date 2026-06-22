-- Macro Map — Supabase schema.
--
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query →
-- paste → Run. It creates a single per-user table that stores the whole app
-- state as JSON, locked down with Row-Level Security so each user can only ever
-- read/write their own row.

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- A user may only see their own row.
drop policy if exists "app_state_select_own" on public.app_state;
create policy "app_state_select_own"
  on public.app_state for select
  using (auth.uid() = user_id);

-- A user may only insert a row for themselves.
drop policy if exists "app_state_insert_own" on public.app_state;
create policy "app_state_insert_own"
  on public.app_state for insert
  with check (auth.uid() = user_id);

-- A user may only update their own row.
drop policy if exists "app_state_update_own" on public.app_state;
create policy "app_state_update_own"
  on public.app_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- (Optional) keep updated_at fresh on every write.
create or replace function public.app_state_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists app_state_set_updated_at on public.app_state;
create trigger app_state_set_updated_at
  before update on public.app_state
  for each row execute function public.app_state_touch_updated_at();
