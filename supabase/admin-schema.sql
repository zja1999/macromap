-- Macro Map — admin access for the in-app Admin tab.
--
-- Grants accounts matched by email in their login JWT read access to ALL
-- requests and feedback, the ability to update request status, and the ability
-- to delete requests/feedback. Everyone else stays limited to their own rows
-- from the earlier schema files.
--
-- IMPORTANT: keep the email list below in sync with `adminEmails` in
-- js/config.js. Run this file in Supabase → SQL Editor after edits.

-- Admins can read every chain request, and update their status (open/added/declined).
drop policy if exists "data_requests_admin_read" on public.data_requests;
create policy "data_requests_admin_read" on public.data_requests
  for select using ((auth.jwt() ->> 'email') in ('zja1999@gmail.com', 'rannyalex15@gmail.com'));

drop policy if exists "data_requests_admin_update" on public.data_requests;
create policy "data_requests_admin_update" on public.data_requests
  for update using ((auth.jwt() ->> 'email') in ('zja1999@gmail.com', 'rannyalex15@gmail.com'))
  with check ((auth.jwt() ->> 'email') in ('zja1999@gmail.com', 'rannyalex15@gmail.com'));

drop policy if exists "data_requests_admin_delete" on public.data_requests;
create policy "data_requests_admin_delete" on public.data_requests
  for delete using ((auth.jwt() ->> 'email') in ('zja1999@gmail.com', 'rannyalex15@gmail.com'));

-- Admins can read and delete all feedback.
drop policy if exists "feedback_admin_read" on public.feedback;
create policy "feedback_admin_read" on public.feedback
  for select using ((auth.jwt() ->> 'email') in ('zja1999@gmail.com', 'rannyalex15@gmail.com'));

drop policy if exists "feedback_admin_delete" on public.feedback;
create policy "feedback_admin_delete" on public.feedback
  for delete using ((auth.jwt() ->> 'email') in ('zja1999@gmail.com', 'rannyalex15@gmail.com'));
