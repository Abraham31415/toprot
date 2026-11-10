-- Saved calculator results, attached to a study.
--
-- A student can save the result of any /tools calculator to one of their studies. Rows are
-- written by the owner only (RLS), and an attached supervisor can read them, matching the
-- other study content tables. The server recomputes the result from the inputs before saving,
-- so the stored result is never taken from the browser as-is.

create table public.saved_calculations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  tool_slug text not null,
  tool_name text not null,
  inputs jsonb not null,
  result jsonb not null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint saved_calculations_inputs_size check (pg_column_size(inputs) <= 20000),
  constraint saved_calculations_result_size check (pg_column_size(result) <= 50000)
);

create index saved_calculations_study_id_idx on public.saved_calculations (study_id, created_at desc);

alter table public.saved_calculations enable row level security;

create policy "saved_calculations_owner_all" on public.saved_calculations for all
  using (public.is_study_owner(study_id))
  with check (public.is_study_owner(study_id));

create policy "saved_calculations_supervisor_select" on public.saved_calculations for select
  using (public.is_study_supervisor(study_id));
