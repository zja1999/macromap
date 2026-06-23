-- Macro Map — admin nutrition uploads (in-app CSV/Excel uploader).
--
-- Lets admins write the shared menu database (chains + menu_items) directly
-- from the browser Admin tab, and records every upload in a changelog. Run
-- AFTER admin-schema.sql (which defines public.is_admin()).

-- Admins may write the shared menu database (the import script's service role
-- still bypasses RLS, so both paths work).
drop policy if exists "chains_admin_insert" on public.chains;
create policy "chains_admin_insert" on public.chains for insert with check (public.is_admin());
drop policy if exists "chains_admin_update" on public.chains;
create policy "chains_admin_update" on public.chains for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "chains_admin_delete" on public.chains;
create policy "chains_admin_delete" on public.chains for delete using (public.is_admin());

drop policy if exists "menu_items_admin_insert" on public.menu_items;
create policy "menu_items_admin_insert" on public.menu_items for insert with check (public.is_admin());
drop policy if exists "menu_items_admin_update" on public.menu_items;
create policy "menu_items_admin_update" on public.menu_items for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "menu_items_admin_delete" on public.menu_items;
create policy "menu_items_admin_delete" on public.menu_items for delete using (public.is_admin());

-- Upload changelog: who uploaded, how many items, which chains, when.
create table if not exists public.upload_log (
  id          uuid primary key default gen_random_uuid(),
  uploader_email text,
  uploader_id uuid references auth.users (id) on delete set null,
  item_count  int  not null default 0,
  chain_count int  not null default 0,
  chains      text not null default '',     -- concatenated chain names in the file
  filename    text,
  created_at  timestamptz not null default now()
);
alter table public.upload_log enable row level security;

drop policy if exists "upload_log_admin_read" on public.upload_log;
create policy "upload_log_admin_read" on public.upload_log for select using (public.is_admin());

drop policy if exists "upload_log_admin_insert" on public.upload_log;
create policy "upload_log_admin_insert" on public.upload_log for insert with check (public.is_admin());
