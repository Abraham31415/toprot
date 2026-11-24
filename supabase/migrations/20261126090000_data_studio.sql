-- Data Studio: datasets, immutable dataset versions, saved analyses and charts, plan limits and compute metering.
--
-- Design (see docs/DATA_STUDIO.md):
--   * Everything belongs to a project (studies.id). Reading follows public.can_read_study, the same rule as every other project table.
--   * The browser can READ metadata through row level security but can never WRITE these tables. Every write goes through a server action
--     that checks the project role (lib/collab/access.ts), recomputes what it stores (parsing, checksums, statistics), and writes with the
--     service role. So a stored version checksum or an analysis result can never be supplied by the browser.
--   * Dataset contents live in the private Storage bucket 'ds-data' (service role only). Raw uploads land in 'ds-uploads' under
--     '<study id>/<user id>/...', writable by project editors, and are deleted once imported.
--   * Versions are immutable. An analysis references a version, never a mutable dataset.
--   * Limits are rows in ds_plan_limits keyed by the existing plans table. Nothing is hard-coded in the application.

-- 1. Plan limits ----------------------------------------------------------------------------------------------------------------------------

create table public.ds_plan_limits (
  plan_key text primary key references public.plans (plan_key) on update cascade on delete cascade,
  max_datasets_per_project int not null check (max_datasets_per_project >= 0),
  max_rows int not null check (max_rows > 0),
  max_columns int not null check (max_columns > 0),
  max_upload_bytes bigint not null check (max_upload_bytes > 0),
  max_project_storage_bytes bigint not null check (max_project_storage_bytes > 0),
  max_versions_per_dataset int not null check (max_versions_per_dataset > 0),
  max_analyses_per_day int not null check (max_analyses_per_day >= 0),
  method_tier text not null check (method_tier in ('basic', 'standard', 'advanced')),
  exports text[] not null default array['csv'],
  updated_at timestamptz not null default now()
);
comment on table public.ds_plan_limits is 'Data Studio limits per plan. Edit with SQL; the application reads them on every request.';

insert into public.ds_plan_limits
  (plan_key, max_datasets_per_project, max_rows, max_columns, max_upload_bytes, max_project_storage_bytes, max_versions_per_dataset, max_analyses_per_day, method_tier, exports)
select v.* from (values
  ('free', 3,   5000,   100, 5242880::bigint,  26214400::bigint,   20,  60,   'basic',    array['csv']),
  ('pro',  25,  100000, 500, 26214400::bigint, 524288000::bigint,  200, 600,  'standard', array['csv', 'svg', 'png', 'python']),
  ('team', 100, 100000, 500, 26214400::bigint, 2147483648::bigint, 500, 3000, 'advanced', array['csv', 'svg', 'png', 'python'])
) as v(plan_key, a, b, c, d, e, f, g, h, i)
where exists (select 1 from public.plans p where p.plan_key = v.plan_key)
on conflict (plan_key) do nothing;

-- The limits that govern a project: those of the plan that governs the project (owner's plan, or the team's plan for a team project).
-- Falls back to the free row, and to built-in minimums if even that row is missing, so a missing row never grants more.
create or replace function public.ds_project_limits(p_study uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_plan text; l public.ds_plan_limits;
begin
  v_plan := coalesce(public.collab_project_plan(p_study), 'free');
  select * into l from public.ds_plan_limits where plan_key = v_plan;
  if not found then select * into l from public.ds_plan_limits where plan_key = 'free'; end if;
  if not found then
    return jsonb_build_object('plan', v_plan, 'max_datasets_per_project', 1, 'max_rows', 1000, 'max_columns', 50, 'max_upload_bytes', 1048576,
      'max_project_storage_bytes', 5242880, 'max_versions_per_dataset', 5, 'max_analyses_per_day', 20, 'method_tier', 'basic', 'exports', jsonb_build_array('csv'));
  end if;
  return jsonb_build_object('plan', v_plan, 'max_datasets_per_project', l.max_datasets_per_project, 'max_rows', l.max_rows, 'max_columns', l.max_columns,
    'max_upload_bytes', l.max_upload_bytes, 'max_project_storage_bytes', l.max_project_storage_bytes, 'max_versions_per_dataset', l.max_versions_per_dataset,
    'max_analyses_per_day', l.max_analyses_per_day, 'method_tier', l.method_tier, 'exports', to_jsonb(l.exports));
end $$;

-- 2. Datasets and versions ------------------------------------------------------------------------------------------------------------------

create table public.ds_datasets (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  source_filename text check (char_length(source_filename) <= 255),
  source_format text check (source_format in ('csv', 'tsv', 'txt', 'xlsx', 'json', 'manual', 'derived')),
  current_version_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null
);
create index ds_datasets_study_idx on public.ds_datasets (study_id, updated_at desc) where deleted_at is null;
create index ds_datasets_created_by_idx on public.ds_datasets (created_by);
create index ds_datasets_deleted_by_idx on public.ds_datasets (deleted_by);

create table public.ds_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.ds_datasets (id) on delete cascade,
  study_id uuid not null references public.studies (id) on delete cascade,
  version_no int not null check (version_no >= 1),
  parent_version_id uuid references public.ds_versions (id) on delete restrict,
  storage_path text not null check (char_length(storage_path) <= 300),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  n_rows int not null check (n_rows >= 0),
  n_cols int not null check (n_cols >= 0),
  bytes bigint not null check (bytes >= 0),
  variables jsonb not null,
  operations jsonb not null default '[]'::jsonb,
  change_description text not null default '' check (char_length(change_description) <= 500),
  import_report jsonb,
  engine_version text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (dataset_id, version_no),
  constraint ds_versions_variables_size check (pg_column_size(variables) <= 1000000),
  constraint ds_versions_operations_size check (pg_column_size(operations) <= 500000)
);
create index ds_versions_dataset_idx on public.ds_versions (dataset_id, version_no desc);
create index ds_versions_study_idx on public.ds_versions (study_id);
create index ds_versions_parent_idx on public.ds_versions (parent_version_id);
create index ds_versions_created_by_idx on public.ds_versions (created_by);

alter table public.ds_datasets add constraint ds_datasets_current_version_fk
  foreign key (current_version_id) references public.ds_versions (id) on delete set null deferrable initially deferred;
create index ds_datasets_current_version_idx on public.ds_datasets (current_version_id);

-- A version's study must be its dataset's study, and its parent must belong to the same dataset.
create or replace function public.ds_version_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ds_version_immutable' using errcode = 'P0001', hint = 'Dataset versions cannot be changed. Create a new version instead.';
  end if;
  if not exists (select 1 from public.ds_datasets d where d.id = new.dataset_id and d.study_id = new.study_id) then
    raise exception 'ds_version_study_mismatch' using errcode = 'P0001';
  end if;
  if new.parent_version_id is not null and not exists (select 1 from public.ds_versions p where p.id = new.parent_version_id and p.dataset_id = new.dataset_id) then
    raise exception 'ds_version_parent_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger ds_versions_guard before insert or update on public.ds_versions for each row execute function public.ds_version_guard();

-- The plan's dataset count is enforced in the database, so two simultaneous imports cannot both slip past it.
create or replace function public.ds_dataset_limit_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_max int;
begin
  perform pg_advisory_xact_lock(hashtext('ds_datasets:' || new.study_id::text));
  v_max := (public.ds_project_limits(new.study_id) ->> 'max_datasets_per_project')::int;
  if (select count(*) from public.ds_datasets where study_id = new.study_id and deleted_at is null) >= v_max then
    raise exception 'ds_dataset_limit' using errcode = 'P0001', detail = v_max::text;
  end if;
  return new;
end $$;
create trigger ds_datasets_limit before insert on public.ds_datasets for each row execute function public.ds_dataset_limit_guard();

-- 3. Analyses and charts -------------------------------------------------------------------------------------------------------------------

create table public.ds_analyses (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  dataset_id uuid not null references public.ds_datasets (id) on delete cascade,
  version_id uuid not null references public.ds_versions (id) on delete cascade,
  method text not null check (method ~ '^[a-z][a-z0-9_]{1,60}$'),
  title text not null check (char_length(title) between 1 and 200),
  config jsonb not null,
  result jsonb,
  status text not null check (status in ('completed', 'failed')),
  error text check (char_length(error) <= 1000),
  engine_version text not null,
  duration_ms int not null default 0,
  pinned boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ds_analyses_config_size check (pg_column_size(config) <= 50000),
  constraint ds_analyses_result_size check (pg_column_size(result) <= 2000000),
  constraint ds_analyses_failed_has_no_result check (status = 'completed' or result is null)
);
create index ds_analyses_study_idx on public.ds_analyses (study_id, created_at desc);
create index ds_analyses_dataset_idx on public.ds_analyses (dataset_id, created_at desc);
create index ds_analyses_version_idx on public.ds_analyses (version_id);
create index ds_analyses_created_by_idx on public.ds_analyses (created_by);

-- Results are evidence: only the pinned flag and title may change after the row is written.
create or replace function public.ds_analysis_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.result is distinct from old.result or new.config is distinct from old.config or new.version_id is distinct from old.version_id
     or new.method is distinct from old.method or new.status is distinct from old.status or new.engine_version is distinct from old.engine_version then
    raise exception 'ds_analysis_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger ds_analyses_guard before update on public.ds_analyses for each row execute function public.ds_analysis_guard();

create table public.ds_charts (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  dataset_id uuid not null references public.ds_datasets (id) on delete cascade,
  version_id uuid not null references public.ds_versions (id) on delete cascade,
  chart_type text not null check (chart_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  title text not null check (char_length(title) between 1 and 200),
  spec jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ds_charts_spec_size check (pg_column_size(spec) <= 50000)
);
create index ds_charts_study_idx on public.ds_charts (study_id, created_at desc);
create index ds_charts_dataset_idx on public.ds_charts (dataset_id);
create index ds_charts_version_idx on public.ds_charts (version_id);
create index ds_charts_created_by_idx on public.ds_charts (created_by);

-- 4. Compute metering (separate from AI credits) -------------------------------------------------------------------------------------------

create table public.ds_usage (
  id bigint generated always as identity primary key,
  study_id uuid references public.studies (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('import', 'version', 'analysis', 'export', 'analysis_failed')),
  units int not null default 1,
  duration_ms int not null default 0,
  bytes bigint not null default 0,
  method text,
  created_at timestamptz not null default now()
);
create index ds_usage_user_day_idx on public.ds_usage (user_id, kind, created_at desc);
create index ds_usage_study_idx on public.ds_usage (study_id, created_at desc);

-- Atomically checks the daily analysis allowance for the project's plan and records one unit. Returns {ok, used, limit}.
-- Counted per person per project per UTC day, so a collaborator on a free project is held to that project's limits.
create or replace function public.ds_meter_analysis(p_actor uuid, p_study uuid, p_method text, p_duration_ms int default 0, p_failed boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_limit int; v_used int;
begin
  perform pg_advisory_xact_lock(hashtext('ds_meter:' || p_actor::text || ':' || p_study::text));
  v_limit := (public.ds_project_limits(p_study) ->> 'max_analyses_per_day')::int;
  select count(*) into v_used from public.ds_usage
   where user_id = p_actor and study_id = p_study and kind in ('analysis', 'analysis_failed') and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if v_used >= v_limit then
    return jsonb_build_object('ok', false, 'used', v_used, 'limit', v_limit);
  end if;
  insert into public.ds_usage (study_id, user_id, kind, method, duration_ms) values (p_study, p_actor, case when p_failed then 'analysis_failed' else 'analysis' end, p_method, coalesce(p_duration_ms, 0));
  return jsonb_build_object('ok', true, 'used', v_used + 1, 'limit', v_limit);
end $$;

-- Bytes of dataset versions stored for a project (used to enforce the storage quota before a new version is written).
create or replace function public.ds_project_bytes(p_study uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(sum(v.bytes), 0)::bigint from public.ds_versions v join public.ds_datasets d on d.id = v.dataset_id where v.study_id = p_study and d.deleted_at is null $$;

-- Admin overview without research data: counts, sizes and timings only.
create or replace function public.ds_admin_overview(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'datasets', (select count(*) from public.ds_datasets where deleted_at is null),
    'versions', (select count(*) from public.ds_versions),
    'stored_bytes', (select coalesce(sum(bytes), 0) from public.ds_versions),
    'analyses', (select count(*) from public.ds_usage where kind = 'analysis' and created_at > now() - make_interval(days => p_days)),
    'analyses_failed', (select count(*) from public.ds_usage where kind = 'analysis_failed' and created_at > now() - make_interval(days => p_days)),
    'imports', (select count(*) from public.ds_usage where kind = 'import' and created_at > now() - make_interval(days => p_days)),
    'avg_analysis_ms', (select coalesce(round(avg(duration_ms)), 0) from public.ds_usage where kind = 'analysis' and created_at > now() - make_interval(days => p_days)),
    'by_method', coalesce((select jsonb_object_agg(method, n) from (select method, count(*) n from public.ds_usage where kind in ('analysis', 'analysis_failed') and created_at > now() - make_interval(days => p_days) group by method) m), '{}'::jsonb)
  )
$$;

-- 5. Row level security: members read, nobody writes from the browser ---------------------------------------------------------------------

alter table public.ds_plan_limits enable row level security;
alter table public.ds_datasets enable row level security;
alter table public.ds_versions enable row level security;
alter table public.ds_analyses enable row level security;
alter table public.ds_charts enable row level security;
alter table public.ds_usage enable row level security;

create policy ds_plan_limits_read on public.ds_plan_limits for select using (true);
create policy ds_datasets_read on public.ds_datasets for select using (deleted_at is null and public.can_read_study(study_id));
create policy ds_versions_read on public.ds_versions for select using (public.can_read_study(study_id));
create policy ds_analyses_read on public.ds_analyses for select using (public.can_read_study(study_id));
create policy ds_charts_read on public.ds_charts for select using (public.can_read_study(study_id));
-- ds_usage: no policy, so the browser sees nothing.

revoke insert, update, delete on public.ds_plan_limits, public.ds_datasets, public.ds_versions, public.ds_analyses, public.ds_charts, public.ds_usage from anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('ds_meter_analysis', 'ds_project_bytes', 'ds_admin_overview', 'ds_project_limits', 'ds_version_guard', 'ds_dataset_limit_guard', 'ds_analysis_guard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- 6. Storage --------------------------------------------------------------------------------------------------------------------------------

-- Canonical dataset contents: service role only (no policies), written and read by the server after its own permission check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ds-data', 'ds-data', false, 209715200, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Raw uploads waiting to be imported: '<study id>/<user id>/<random>.<ext>'. A project editor may write only into their own folder of a
-- project they can write. The hard ceiling here is the largest plan limit; the server enforces the project's own limit when importing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ds-uploads', 'ds-uploads', false, 26214400, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy ds_uploads_insert on storage.objects for insert
  with check (bucket_id = 'ds-uploads' and public.storage_study_of(name) is not null
              and (storage.foldername(name))[2] = auth.uid()::text
              and public.can_write_study(public.storage_study_of(name)));
create policy ds_uploads_select_own on storage.objects for select
  using (bucket_id = 'ds-uploads' and (storage.foldername(name))[2] = auth.uid()::text);
create policy ds_uploads_delete_own on storage.objects for delete
  using (bucket_id = 'ds-uploads' and (storage.foldername(name))[2] = auth.uid()::text);

-- 7. AI Research Analyst -----------------------------------------------------------------------------------------------------------------
-- Interprets already-computed results; metered by the existing AI credit system. Ordinary analyses never consume AI credits.
-- Added to paid plans only (Free keeps its current AI features, unchanged).
insert into public.ai_features
  (feature_key, description, model_chain, max_output_tokens, max_input_chars, max_iterations, max_tool_calls, max_op_cost_micro_usd)
values
  ('data_analyst', 'Data Studio: explains and drafts text from computed statistical results (aggregated outputs only, no raw data)',
   array['claude-sonnet-5-5', 'claude-haiku-5-5'], 2000, 40000, 1, 0, 150000)
on conflict (feature_key) do nothing;
update public.plans set ai_features = array_append(ai_features, 'data_analyst')
 where plan_key in ('pro', 'team') and not ('data_analyst' = any (ai_features));
