-- Macro Map — user feedback.
--
-- Run once in Supabase → SQL Editor. Creates the table behind the footer
-- "Send feedback" button. Anyone may submit; you review it in the Table Editor.

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  category   text,                 -- general | idea | bug
  context    text,                 -- which view it was sent from
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Anyone (anon or logged in) may submit feedback.
drop policy if exists "feedback_insert_any" on public.feedback;
create policy "feedback_insert_any" on public.feedback for insert with check (true);

-- A logged-in user may read back the feedback they submitted.
drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback for select using (auth.uid() = user_id);
