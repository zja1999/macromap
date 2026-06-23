-- Macro Map — admin access for the in-app Admin tab.
--
-- Grants accounts matched by email in their login JWT read access to ALL
-- requests and feedback, the ability to update request status, and the ability
-- to delete requests/feedback. Everyone else stays limited to their own rows
-- from the earlier schema files.
--
-- ADDING AN ADMIN: edit the email list in public.is_admin() below (and the
-- matching `adminEmails` array in js/config.js), then run this file in
-- Supabase → SQL Editor. Every admin policy in the app routes through
-- is_admin(), so this one list is the single source of truth for the database.

-- Single source of truth for who is an admin. Used by every admin policy here
-- and in upload-schema.sql.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() ->> 'email') in (
    'zja1999@gmail.com',
    'rannyalex15@gmail.com'
  ), false);
$$;

-- Admins can read every chain request, and update their status (open/added/declined).
drop policy if exists "data_requests_admin_read" on public.data_requests;
create policy "data_requests_admin_read" on public.data_requests
  for select using (public.is_admin());

drop policy if exists "data_requests_admin_update" on public.data_requests;
create policy "data_requests_admin_update" on public.data_requests
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "data_requests_admin_delete" on public.data_requests;
create policy "data_requests_admin_delete" on public.data_requests
  for delete using (public.is_admin());

-- Admins can read and delete all feedback.
drop policy if exists "feedback_admin_read" on public.feedback;
create policy "feedback_admin_read" on public.feedback
  for select using (public.is_admin());

drop policy if exists "feedback_admin_delete" on public.feedback;
create policy "feedback_admin_delete" on public.feedback
  for delete using (public.is_admin());
