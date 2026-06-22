-- Macro Map — admin (owner) access for the in-app Admin tab.
--
-- Grants one account — matched by email in its login JWT — read access to ALL
-- requests and feedback, and the ability to update request status. Everyone
-- else stays limited to their own rows (from the earlier schema files).
--
-- IMPORTANT: replace the email below with YOUR account email, and make sure it
-- matches `adminEmail` in js/config.js. Run once in Supabase → SQL Editor.

-- Admin can read every chain request, and update their status (open/added/declined).
drop policy if exists "data_requests_admin_read" on public.data_requests;
create policy "data_requests_admin_read" on public.data_requests
  for select using ((auth.jwt() ->> 'email') = 'zja1999@gmail.com');

drop policy if exists "data_requests_admin_update" on public.data_requests;
create policy "data_requests_admin_update" on public.data_requests
  for update using ((auth.jwt() ->> 'email') = 'zja1999@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'zja1999@gmail.com');

drop policy if exists "data_requests_admin_delete" on public.data_requests;
create policy "data_requests_admin_delete" on public.data_requests
  for delete using ((auth.jwt() ->> 'email') = 'zja1999@gmail.com');

-- Admin can read all feedback.
drop policy if exists "feedback_admin_read" on public.feedback;
create policy "feedback_admin_read" on public.feedback
  for select using ((auth.jwt() ->> 'email') = 'zja1999@gmail.com');

drop policy if exists "feedback_admin_delete" on public.feedback;
create policy "feedback_admin_delete" on public.feedback
  for delete using ((auth.jwt() ->> 'email') = 'zja1999@gmail.com');
