-- Collaboration, stage 4: conflict-aware editing, version history, messaging, notification preferences and email, usage monitoring.
--
--   * Protocol sections are saved with compare-and-set: the browser sends the values it started from, and the save is refused (with the
--     other person's current text returned) if someone else changed the same field meanwhile. Edits to different fields merge. Nothing is
--     silently overwritten. Manuscripts already refuse stale revisions (save_manuscript) and keep their own version history.
--   * Protocol history: automatic snapshots of the previous text, plus restore (which snapshots the current text first, so a restore can be undone).
--   * Messages: one conversation per project (people who can comment) and one per team (paid members). Rate limited in the database.
--     Realtime and presence make them live, but every screen also loads and refreshes through plain queries, so nothing depends on realtime.
--   * Notifications: users choose in-app and email per category. Emails are queued and a job sends them through Resend; a notification is
--     only marked as emailed when the provider accepted it. Daily and monthly send counts are tracked against configurable quotas, with alerts.

-- 1. Settings -------------------------------------------------------------------------------------------------------------------------------

insert into public.billing_settings (key, value_num, description) values
  ('collab_messages_per_minute', 20, 'Most messages one account may send per minute.'),
  ('collab_messages_per_hour', 300, 'Most messages one account may send per hour.'),
  ('collab_emails_per_user_per_hour', 6, 'Most notification emails one account receives per hour; more are held back and shown in-app only.'),
  ('collab_resend_daily_limit', 100, 'Resend emails per day your plan allows (free plan: 100). Used for the usage warning and to pause sending.'),
  ('collab_resend_monthly_limit', 3000, 'Resend emails per month your plan allows (free plan: 3000).'),
  ('collab_quota_alert_pct', 80, 'Raise an admin alert when email use reaches this percent of the daily or monthly limit.'),
  ('collab_realtime_joins_daily_alert', 5000, 'Raise an admin alert when browsers report this many realtime channel joins in a day (a rough guide; the Supabase dashboard has the real connection count).')
on conflict (key) do nothing;

-- 2. Protocol: compare-and-set saves, authorship and history ---------------------------------------------------------------------------------

alter table public.protocol_versions add column if not exists updated_by uuid references public.profiles (id) on delete set null;

create or replace function public.protocol_touch() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin if auth.uid() is not null then new.updated_by := auth.uid(); end if; new.updated_at := now(); return new; end $$;
create trigger protocol_versions_touch before update on public.protocol_versions for each row execute function public.protocol_touch();

create table public.protocol_snapshots (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.protocol_versions (id) on delete cascade,
  study_id uuid not null references public.studies (id) on delete cascade,
  kind text not null check (kind in ('auto', 'manual', 'restore')),
  label text check (label is null or length(label) <= 120),
  content jsonb not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index protocol_snapshots_version_idx on public.protocol_snapshots (version_id, created_at desc);
alter table public.protocol_snapshots enable row level security;
revoke all on table public.protocol_snapshots from public, anon, authenticated;
grant select on public.protocol_snapshots to authenticated;
create policy protocol_snapshots_read on public.protocol_snapshots for select to authenticated using (public.can_read_study(study_id));

create or replace function public.protocol_content_columns() returns text[] language sql immutable
as $$ select array['study_title','short_title','study_design','site','principal_investigator_name','anticipated_start_date','anticipated_end_date','research_question',
  'target_population','setting','inclusion_criteria','exclusion_criteria','statistical_methods','primary_analysis','significance_level','analysis_software',
  'sample_size_method','sample_size_inputs','calculated_sample_size','stress_test_results','data_collection_methods','data_sources','data_management_plan',
  'ethical_approval_body','consent_process','risks_and_benefits','confidentiality_plan'] $$;

create or replace function public.protocol_content_of(p_row jsonb) returns jsonb language sql immutable
as $$ select coalesce(jsonb_object_agg(k, p_row -> k), '{}'::jsonb) from unnest(public.protocol_content_columns()) k $$;

-- Security definer with an explicit can_write_study check (users have no direct write access to snapshots); the registered-version and editor triggers still apply.
create or replace function public.save_protocol_section(p_version uuid, p_base jsonb, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare cur jsonb; k text; v_allowed text[] := public.protocol_content_columns(); v_conflicts jsonb := '{}'::jsonb; v_sets text := ''; v_last timestamptz; v_study uuid;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_base) is distinct from 'object' then raise exception 'invalid_save' using errcode = '22023'; end if;
  select to_jsonb(v) into cur from public.protocol_versions v where v.id = p_version for update;
  if cur is null or not public.can_read_study((cur ->> 'study_id')::uuid) then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  if not public.can_write_study((cur ->> 'study_id')::uuid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if cur ->> 'status' <> 'draft' then raise exception 'version_locked' using errcode = 'P0001'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (v_allowed)) then raise exception 'invalid_field' using errcode = '22023'; end if;
    if (cur -> k) is distinct from (p_base -> k) and (cur -> k) is distinct from (p_patch -> k) then v_conflicts := v_conflicts || jsonb_build_object(k, cur -> k); end if;
    v_sets := v_sets || case when v_sets = '' then '' else ', ' end || format('%I = r.%I', k, k);
  end loop;
  if v_sets = '' then return jsonb_build_object('ok', true); end if;
  if v_conflicts <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'conflicts', v_conflicts, 'updated_by', (select full_name from public.profiles where id = (cur ->> 'updated_by')::uuid));
  end if;
  v_study := (cur ->> 'study_id')::uuid;
  select max(created_at) into v_last from public.protocol_snapshots where version_id = p_version and kind = 'auto';
  if v_last is null or v_last < now() - interval '10 minutes' then
    insert into public.protocol_snapshots (version_id, study_id, kind, content, created_by) values (p_version, v_study, 'auto', public.protocol_content_of(cur), auth.uid());
    delete from public.protocol_snapshots where version_id = p_version and kind = 'auto'
      and id not in (select id from public.protocol_snapshots where version_id = p_version and kind = 'auto' order by created_at desc limit 30);
  end if;
  execute format('update public.protocol_versions p set %s from jsonb_populate_record(null::public.protocol_versions, $1) r where p.id = $2', v_sets) using (cur || p_patch), p_version;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.snapshot_protocol(p_version uuid, p_label text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare cur jsonb; v_id uuid;
begin
  select to_jsonb(v) into cur from public.protocol_versions v where v.id = p_version;
  if cur is null then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  if not public.can_write_study((cur ->> 'study_id')::uuid) then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.protocol_snapshots (version_id, study_id, kind, label, content, created_by)
  values (p_version, (cur ->> 'study_id')::uuid, 'manual', left(nullif(btrim(p_label), ''), 120), public.protocol_content_of(cur), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.restore_protocol_snapshot(p_snapshot uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.protocol_snapshots%rowtype; cur jsonb; k text; v_sets text := '';
begin
  select * into s from public.protocol_snapshots where id = p_snapshot;
  if not found then raise exception 'snapshot_not_found' using errcode = 'P0002'; end if;
  if not public.can_write_study(s.study_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select to_jsonb(v) into cur from public.protocol_versions v where v.id = s.version_id for update;
  if cur is null or cur ->> 'status' <> 'draft' then raise exception 'version_locked' using errcode = 'P0001'; end if;
  insert into public.protocol_snapshots (version_id, study_id, kind, label, content, created_by) values (s.version_id, s.study_id, 'restore', 'Before restore', public.protocol_content_of(cur), auth.uid());
  for k in select unnest(public.protocol_content_columns()) loop
    v_sets := v_sets || case when v_sets = '' then '' else ', ' end || format('%I = r.%I', k, k);
  end loop;
  execute format('update public.protocol_versions p set %s from jsonb_populate_record(null::public.protocol_versions, $1) r where p.id = $2', v_sets) using (cur || s.content), s.version_id;
  return s.content;
end $$;

-- 3. Messages -----------------------------------------------------------------------------------------------------------------------------------

create table public.collab_messages (
  id uuid primary key default gen_random_uuid(),
  study_id uuid references public.studies (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  check ((study_id is null) <> (team_id is null))
);
create index collab_messages_study_idx on public.collab_messages (study_id, created_at desc) where study_id is not null;
create index collab_messages_team_idx on public.collab_messages (team_id, created_at desc) where team_id is not null;
create index collab_messages_author_idx on public.collab_messages (author_id, created_at desc);

create table public.collab_read_state (
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation text not null check (conversation ~ '^(project|team):[0-9a-f-]{36}$'),
  last_read_at timestamptz not null default now(),
  primary key (user_id, conversation)
);

create or replace function public.collab_can_read_conversation(p_user uuid, p_conversation text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_user is distinct from auth.uid() and current_setting('role', true) in ('anon', 'authenticated') then return false; end if; -- no probing of other accounts
  if p_conversation !~ '^(project|team):[0-9a-f-]{36}$' then return false; end if;
  v_id := split_part(p_conversation, ':', 2)::uuid;
  if p_conversation like 'project:%' then return coalesce(public.study_role(v_id, p_user) is not null, false); end if;
  return coalesce(public.team_role_of(v_id, p_user) in ('owner', 'administrator', 'member'), false);
end $$;

create or replace function public.collab_can_post(p_user uuid, p_conversation text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_id uuid := case when p_conversation ~ '^(project|team):[0-9a-f-]{36}$' then split_part(p_conversation, ':', 2)::uuid end;
begin
  if v_id is null then return false; end if;
  if p_conversation like 'project:%' then return coalesce(public.study_role(v_id, p_user) in ('owner', 'editor', 'reviewer'), false); end if;
  return coalesce(public.team_role_of(v_id, p_user) in ('owner', 'administrator', 'member'), false);
end $$;

create or replace function public.collab_message_visible(p_study uuid, p_team uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select case when p_study is not null then public.can_read_study(p_study) else coalesce(public.team_is_paid_member(p_team, auth.uid()), false) end $$;

alter table public.collab_messages enable row level security;
alter table public.collab_read_state enable row level security;
revoke all on table public.collab_messages, public.collab_read_state from public, anon, authenticated;
grant select on public.collab_messages to authenticated;
create policy collab_messages_read on public.collab_messages for select to authenticated using (public.collab_message_visible(study_id, team_id));

create or replace function public.collab_message_send(p_actor uuid, p_conversation text, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_body text := btrim(coalesce(p_body, '')); v_study uuid; v_team uuid; v_msg uuid; v_at timestamptz;
begin
  if not public.collab_can_post(p_actor, p_conversation) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(v_body) < 1 or length(v_body) > 4000 then raise exception 'invalid_message' using errcode = '22023'; end if;
  if (select count(*) from public.collab_messages where author_id = p_actor and created_at > now() - interval '1 minute') >= public.billing_setting_num('collab_messages_per_minute')
     or (select count(*) from public.collab_messages where author_id = p_actor and created_at > now() - interval '1 hour') >= public.billing_setting_num('collab_messages_per_hour')
  then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  v_id := split_part(p_conversation, ':', 2)::uuid;
  if p_conversation like 'project:%' then v_study := v_id; else v_team := v_id; end if;
  insert into public.collab_messages (study_id, team_id, author_id, body) values (v_study, v_team, p_actor, v_body) returning id, created_at into v_msg, v_at;
  insert into public.collab_read_state (user_id, conversation, last_read_at) values (p_actor, p_conversation, v_at)
  on conflict (user_id, conversation) do update set last_read_at = greatest(public.collab_read_state.last_read_at, excluded.last_read_at);
  perform public.collab_usage_bump('messages_sent', 1);
  return jsonb_build_object('id', v_msg, 'created_at', v_at);
end $$;

create or replace function public.collab_messages_list(p_actor uuid, p_conversation text, p_after timestamptz default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.collab_can_read_conversation(p_actor, p_conversation) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_id := split_part(p_conversation, ':', 2)::uuid;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'author_id', m.author_id, 'author', p.full_name, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
    from (select * from public.collab_messages x where (case when p_conversation like 'project:%' then x.study_id else x.team_id end) = v_id
            and (p_after is null or x.created_at > p_after) order by x.created_at desc limit least(greatest(p_limit, 1), 200)) m
    left join public.profiles p on p.id = m.author_id), '[]'::jsonb);
end $$;

create or replace function public.collab_mark_conversation_read(p_actor uuid, p_conversation text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.collab_can_read_conversation(p_actor, p_conversation) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.collab_read_state (user_id, conversation, last_read_at) values (p_actor, p_conversation, now())
  on conflict (user_id, conversation) do update set last_read_at = now();
end $$;

-- Unread messages (from other people) per conversation the account can read.
create or replace function public.collab_unread_messages(p_actor uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_object_agg(c.conversation, c.n), '{}'::jsonb) from (
    select 'project:' || m.study_id as conversation, count(*) as n
      from public.collab_messages m left join public.collab_read_state r on r.user_id = p_actor and r.conversation = 'project:' || m.study_id
     where m.study_id is not null and m.author_id is distinct from p_actor and public.study_role(m.study_id, p_actor) is not null and m.created_at > coalesce(r.last_read_at, '-infinity')
     group by m.study_id
    union all
    select 'team:' || m.team_id, count(*)
      from public.collab_messages m left join public.collab_read_state r on r.user_id = p_actor and r.conversation = 'team:' || m.team_id
     where m.team_id is not null and m.author_id is distinct from p_actor and coalesce(public.team_role_of(m.team_id, p_actor) in ('owner', 'administrator', 'member'), false) and m.created_at > coalesce(r.last_read_at, '-infinity')
     group by m.team_id) c
$$;

-- Realtime: publish new messages (RLS filters who receives them) and authorise presence channels. Guarded so the migration also runs where Realtime is absent.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.collab_messages; exception when duplicate_object then null; end;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute 'create policy collab_realtime_read on realtime.messages for select to authenticated using (public.collab_can_read_conversation(auth.uid(), realtime.topic()))';
    execute 'create policy collab_realtime_write on realtime.messages for insert to authenticated with check (public.collab_can_read_conversation(auth.uid(), realtime.topic()))';
  end if;
end $$;

-- 4. Notification preferences, email queue and usage counters -------------------------------------------------------------------------------

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  review_inapp boolean not null default true, review_email boolean not null default true,
  comment_inapp boolean not null default true, comment_email boolean not null default false,
  team_inapp boolean not null default true, team_email boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from public, anon, authenticated;
grant select on public.notification_preferences to authenticated;
create policy notification_preferences_own on public.notification_preferences for select to authenticated using (user_id = auth.uid());

alter table public.notifications
  add column in_app boolean not null default true,
  add column email_status text not null default 'none' check (email_status in ('none', 'pending', 'sending', 'provider_accepted', 'failed', 'not_configured', 'throttled')),
  add column email_error text,
  add column email_message_id text,
  add column email_at timestamptz,
  add column email_attempts int not null default 0;
create index notifications_email_idx on public.notifications (created_at) where email_status in ('pending', 'sending');

create or replace function public.collab_notify_category(p_kind text) returns text language sql immutable
as $$ select case when p_kind like 'review%' or p_kind = 'changes_requested' then 'review' when p_kind = 'comment' then 'comment' when p_kind like 'team%' or p_kind in ('project_access', 'project_transferred') then 'team' else 'other' end $$;

create or replace function public.collab_notify(p_user uuid, p_kind text, p_study uuid, p_title text, p_body text default null, p_link text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_cat text := public.collab_notify_category(p_kind); pr public.notification_preferences%rowtype; v_in boolean := true; v_mail boolean := false;
begin
  select * into pr from public.notification_preferences where user_id = p_user;
  if found then
    v_in := case v_cat when 'review' then pr.review_inapp when 'comment' then pr.comment_inapp when 'team' then pr.team_inapp else true end;
    v_mail := case v_cat when 'review' then pr.review_email when 'comment' then pr.comment_email when 'team' then pr.team_email else false end;
  else
    v_mail := v_cat = 'review';
  end if;
  if not v_in and not v_mail then return; end if;
  insert into public.notifications (user_id, kind, study_id, title, body, link, in_app, email_status)
  values (p_user, p_kind, p_study, left(p_title, 200), left(p_body, 500), p_link, v_in, case when v_mail then 'pending' else 'none' end);
end $$;

-- Lists and counts show in-app notifications only.
create or replace function public.collab_notifications(p_actor uuid, p_limit int default 50, p_unread_only boolean default false)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
    from (select id, kind, study_id, title, body, link, created_at, read_at from public.notifications
           where user_id = p_actor and in_app and (not p_unread_only or read_at is null) order by created_at desc limit least(greatest(p_limit, 1), 200)) n
$$;
create or replace function public.collab_unread_count(p_actor uuid)
returns int language sql stable security definer set search_path = public, pg_temp
as $$ select count(*)::int from public.notifications where user_id = p_actor and in_app and read_at is null $$;

create or replace function public.collab_prefs_get(p_actor uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$ select to_jsonb(coalesce((select p from public.notification_preferences p where p.user_id = p_actor), row(p_actor, true, true, true, false, true, false, now())::public.notification_preferences)) - 'user_id' - 'updated_at' $$;

create or replace function public.collab_prefs_set(p_actor uuid, p_prefs jsonb) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare k text;
begin
  for k in select jsonb_object_keys(p_prefs) loop
    if k not in ('review_inapp', 'review_email', 'comment_inapp', 'comment_email', 'team_inapp', 'team_email') or jsonb_typeof(p_prefs -> k) <> 'boolean' then raise exception 'invalid_preference' using errcode = '22023'; end if;
  end loop;
  insert into public.notification_preferences (user_id) values (p_actor) on conflict do nothing;
  update public.notification_preferences set
    review_inapp = coalesce((p_prefs ->> 'review_inapp')::boolean, review_inapp), review_email = coalesce((p_prefs ->> 'review_email')::boolean, review_email),
    comment_inapp = coalesce((p_prefs ->> 'comment_inapp')::boolean, comment_inapp), comment_email = coalesce((p_prefs ->> 'comment_email')::boolean, comment_email),
    team_inapp = coalesce((p_prefs ->> 'team_inapp')::boolean, team_inapp), team_email = coalesce((p_prefs ->> 'team_email')::boolean, team_email), updated_at = now()
  where user_id = p_actor;
end $$;

create table public.collab_usage (
  day date not null,
  metric text not null check (metric in ('emails_sent', 'emails_failed', 'emails_throttled', 'messages_sent', 'realtime_joins', 'invitation_emails')),
  count bigint not null default 0,
  primary key (day, metric)
);
alter table public.collab_usage enable row level security;
revoke all on table public.collab_usage from public, anon, authenticated;

create or replace function public.collab_usage_bump(p_metric text, p_n int default 1) returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.collab_usage (day, metric, count) values ((now() at time zone 'UTC')::date, p_metric, greatest(p_n, 0))
      on conflict (day, metric) do update set count = public.collab_usage.count + excluded.count $$;

-- Email use against the configured quotas.
create or replace function public.collab_email_quota() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_day bigint; v_month bigint; v_dl numeric := public.billing_setting_num('collab_resend_daily_limit'); v_ml numeric := public.billing_setting_num('collab_resend_monthly_limit');
begin
  select coalesce(sum(count), 0) into v_day from public.collab_usage where metric in ('emails_sent', 'invitation_emails') and day = (now() at time zone 'UTC')::date;
  select coalesce(sum(count), 0) into v_month from public.collab_usage where metric in ('emails_sent', 'invitation_emails') and day >= date_trunc('month', now() at time zone 'UTC')::date;
  return jsonb_build_object('day_used', v_day, 'day_limit', v_dl, 'month_used', v_month, 'month_limit', v_ml, 'blocked', v_day >= v_dl or v_month >= v_ml,
    'realtime_joins_today', (select coalesce(sum(count), 0) from public.collab_usage where metric = 'realtime_joins' and day = (now() at time zone 'UTC')::date));
end $$;

create or replace function public.collab_check_quota_alerts() returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare q jsonb := public.collab_email_quota(); v_pct numeric := public.billing_setting_num('collab_quota_alert_pct'); n int := 0;
begin
  if (q ->> 'day_used')::numeric >= (q ->> 'day_limit')::numeric * v_pct / 100 then
    if public.system_alert_raise('email_quota', case when (q ->> 'blocked')::boolean then 'critical' else 'warning' end, 'Collaboration email use is at ' || round((q ->> 'day_used')::numeric * 100 / (q ->> 'day_limit')::numeric) || '% of the daily Resend limit', q, 'collab_email_day:' || (now() at time zone 'UTC')::date) then n := n + 1; end if;
  end if;
  if (q ->> 'month_used')::numeric >= (q ->> 'month_limit')::numeric * v_pct / 100 then
    if public.system_alert_raise('email_quota', case when (q ->> 'blocked')::boolean then 'critical' else 'warning' end, 'Collaboration email use is at ' || round((q ->> 'month_used')::numeric * 100 / (q ->> 'month_limit')::numeric) || '% of the monthly Resend limit', q, 'collab_email_month:' || to_char(now(), 'YYYY-MM')) then n := n + 1; end if;
  end if;
  if (q ->> 'realtime_joins_today')::numeric >= public.billing_setting_num('collab_realtime_joins_daily_alert') then
    if public.system_alert_raise('realtime_usage', 'warning', 'Browsers reported ' || (q ->> 'realtime_joins_today') || ' realtime joins today. Check Realtime usage in the Supabase dashboard.', q, 'collab_realtime:' || (now() at time zone 'UTC')::date) then n := n + 1; end if;
  end if;
  return n;
end $$;

-- Claim queued notification emails for sending. Holds back (without losing) anything over the quotas, throttles noisy recipients.
create or replace function public.collab_claim_emails(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare q jsonb := public.collab_email_quota(); r record; v_out jsonb := '[]'::jsonb; v_room int; v_per numeric := public.billing_setting_num('collab_emails_per_user_per_hour');
begin
  update public.notifications set email_status = 'pending' where email_status = 'sending' and email_at < now() - interval '10 minutes' and email_attempts < 3;
  update public.notifications set email_status = 'failed', email_error = 'Gave up after 3 attempts' where email_status = 'sending' and email_attempts >= 3 and email_at < now() - interval '10 minutes';
  perform public.collab_check_quota_alerts();
  if (q ->> 'blocked')::boolean then return v_out; end if;
  v_room := least(p_limit, greatest(((q ->> 'day_limit')::numeric - (q ->> 'day_used')::numeric)::int, 0));
  for r in select n.id, n.user_id, n.title, n.body, n.link from public.notifications n where n.email_status = 'pending' order by n.created_at limit v_room for update skip locked loop
    if (select count(*) from public.notifications where user_id = r.user_id and email_status in ('provider_accepted', 'sending') and email_at > now() - interval '1 hour') >= v_per then
      update public.notifications set email_status = 'throttled' where id = r.id;
      perform public.collab_usage_bump('emails_throttled', 1);
      continue;
    end if;
    update public.notifications set email_status = 'sending', email_at = now(), email_attempts = email_attempts + 1 where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'email', public.collab_user_email(r.user_id), 'title', r.title, 'body', r.body, 'link', r.link));
  end loop;
  return v_out;
end $$;

create or replace function public.collab_mark_email(p_id uuid, p_status text, p_error text default null, p_message_id text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_status not in ('provider_accepted', 'failed', 'not_configured', 'pending') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.notifications set email_status = p_status, email_error = left(p_error, 300), email_message_id = p_message_id, email_at = now() where id = p_id and email_status = 'sending';
  if p_status = 'provider_accepted' then perform public.collab_usage_bump('emails_sent', 1); elsif p_status = 'failed' then perform public.collab_usage_bump('emails_failed', 1); end if;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'collab\_%' or p.proname like 'team\_%')
       and p.proname not in ('collab_project_plan', 'collab_role_limit', 'collab_message_visible', 'team_role', 'team_is_paid_member', 'team_is_member', 'team_doc_can_read', 'team_doc_storage_can_read', 'team_doc_storage_can_insert', 'collab_can_read_conversation')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
grant execute on function public.collab_message_visible(uuid, uuid), public.collab_can_read_conversation(uuid, text), public.save_protocol_section(uuid, jsonb, jsonb),
  public.snapshot_protocol(uuid, text), public.restore_protocol_snapshot(uuid) to authenticated, service_role;
