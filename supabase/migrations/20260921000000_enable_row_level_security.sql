-- Every table below already has RLS policies defined (see 20260919002910_auth_and_rls.sql
-- and later migrations), but row level security was never actually switched on for any of
-- them. A policy with RLS disabled on its table is inert -- Postgres/PostgREST serves the
-- table as if no policy existed at all. In practice this means any caller holding the
-- public anon key (embedded in every page load by design) can read and write every row in
-- every one of these tables via Supabase's REST API, bypassing every ownership/supervisor
-- check the policies were meant to enforce.

alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table studies enable row level security;
alter table protocol_versions enable row level security;
alter table protocol_objectives enable row level security;
alter table protocol_variables enable row level security;
alter table milestones enable row level security;
alter table deviations enable row level security;
alter table generated_outputs enable row level security;
alter table deviation_reports enable row level security;
alter table study_supervisors enable row level security;
alter table supervisor_invitations enable row level security;
alter table amendments enable row level security;
