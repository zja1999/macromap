-- Macro Map — shared nutrition database + chain requests.
--
-- Run once in Supabase → SQL Editor (after schema.sql). Creates the public,
-- shared restaurant database that every user reads from, plus a central table
-- where chain-data requests land for you to review.
--
-- Security model:
--   chains / menu_items : world-readable (anon + logged in), writable only by
--                         the service role (your import script / dashboard).
--   data_requests       : anyone may submit; a user can read their own; you
--                         review them all in the Table Editor (which bypasses RLS).

-- ---------------------------------------------------------------- chains
create table if not exists public.chains (
  id         text primary key,                 -- slug, e.g. "mcdonalds"
  name       text not null,
  color      text,
  match      text[] not null default '{}',     -- OSM brand aliases (lowercase)
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------- menu_items
create table if not exists public.menu_items (
  id         text primary key,                 -- deterministic: "<chain_id>:<slug(name)>"
  chain_id   text not null references public.chains (id) on delete cascade,
  name       text not null,
  category   text,
  kcal       numeric,
  protein    numeric,
  carbs      numeric,
  fat        numeric,
  sodium     numeric,
  fiber      numeric,
  sugar      numeric,
  updated_at timestamptz not null default now()
);
create index if not exists menu_items_chain_id_idx on public.menu_items (chain_id);

-- -------------------------------------------------------- data_requests
create table if not exists public.data_requests (
  id         uuid primary key default gen_random_uuid(),
  chain      text not null,
  note       text,
  lat        double precision,
  lng        double precision,
  user_id    uuid references auth.users (id) on delete set null,
  status     text not null default 'open',     -- open | added | declined
  created_at timestamptz not null default now()
);
create index if not exists data_requests_status_idx on public.data_requests (status);

-- --------------------------------------------------------------- RLS
alter table public.chains        enable row level security;
alter table public.menu_items    enable row level security;
alter table public.data_requests enable row level security;

-- Public read of the menu database (no write policies => clients cannot write;
-- the service role used by the import script bypasses RLS).
drop policy if exists "chains_public_read" on public.chains;
create policy "chains_public_read" on public.chains for select using (true);

drop policy if exists "menu_items_public_read" on public.menu_items;
create policy "menu_items_public_read" on public.menu_items for select using (true);

-- Anyone (anon or logged in) may submit a request.
drop policy if exists "data_requests_insert_any" on public.data_requests;
create policy "data_requests_insert_any" on public.data_requests for insert with check (true);

-- A logged-in user may see the requests they submitted.
drop policy if exists "data_requests_select_own" on public.data_requests;
create policy "data_requests_select_own" on public.data_requests for select using (auth.uid() = user_id);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists chains_touch on public.chains;
create trigger chains_touch before update on public.chains
  for each row execute function public.touch_updated_at();

drop trigger if exists menu_items_touch on public.menu_items;
create trigger menu_items_touch before update on public.menu_items
  for each row execute function public.touch_updated_at();
