-- Collaboration, stage 1: project memberships, secure invitations and project roles.
--
-- Design (read this before changing anything here):
--   * A "project" is a row of public.studies. Its owner is studies.owner_id. Nothing about ownership moves.
--   * Everyone else who may see or edit a project holds ONE row in public.project_memberships with a project role:
--       editor   read and write the project's content, cannot lock or register a protocol, invite, remove or delete
--       reviewer read, comment, review and approve (the existing "supervisor" powers)
--       viewer   read only
--     The owner is implicit (studies.owner_id) and never has a membership row.
--   * profiles.role (student / supervisor) is a display label. It grants NOTHING. Every permission below is derived from
--     studies.owner_id and project_memberships only (see study_role).
--   * Plan limits are data (collab_role_limits, billing_settings). A role whose limit is 0 on the project owner's plan is dormant:
--     the membership stays but gives no access until the owner's plan allows that role again. Renaming a role label cannot change
--     any of this because limits count the ROLE column, and labels live in a separate column.
--   * Invitations carry a hashed, expiring, single-use token. Only the server (service role) creates, resends, revokes and accepts
--     invitations; accepting requires the signed-in account's email to equal the invited email.
--   * The older study_supervisors / supervisor_invitations tables are kept as read-only history (no data is deleted). Their rows are
--     copied here, and they can no longer be written through the API.

-- 1. Settings and plan limits -------------------------------------------------------------------------------------------------

insert into public.billing_settings (key, value_num, description) values
  ('collab_invite_expiry_days', 14, 'An invitation can be accepted for this many days after it is sent or resent.'),
  ('collab_invites_per_owner_per_day', 20, 'Most project invitations one owner may create in 24 hours.'),
  ('collab_invites_per_email_per_day', 3, 'Most invitations any one email address may receive from all of ToProt in 24 hours (stops harassment).'),
  ('collab_pending_invites_per_project', 15, 'Most pending invitations one project may hold at once.'),
  ('collab_resend_cooldown_minutes', 10, 'Minimum wait before an invitation can be resent.'),
  ('collab_max_resends', 5, 'Most times one invitation may be resent.')
on conflict (key) do nothing;

create table public.collab_role_limits (
  plan_key text not null,
  role text not null check (role in ('reviewer', 'editor', 'viewer')),
  max_per_project int not null check (max_per_project >= 0),
  updated_at timestamptz not null default now(),
  primary key (plan_key, role)
);
comment on table public.collab_role_limits is
  'How many members of each project role one project may have under a plan. 0 means the plan does not allow that role. Edit with SQL; nothing is hard-coded.';
insert into public.collab_role_limits (plan_key, role, max_per_project) values
  ('free', 'reviewer', 2), ('free', 'editor', 0), ('free', 'viewer', 0),
  ('pro', 'reviewer', 5), ('pro', 'editor', 5), ('pro', 'viewer', 10);

-- 2. Tables -----------------------------------------------------------------------------------------------------------------------

create table public.project_memberships (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('editor', 'reviewer', 'viewer')),
  -- Display only ("Supervisor", "Co-investigator"). Never read by any permission check.
  title_label text check (title_label is null or title_label in ('supervisor', 'co_investigator', 'collaborator', 'advisor', 'statistician')),
  added_by uuid references public.profiles (id) on delete set null,
  invitation_id uuid,
  created_at timestamptz not null default now(),
  unique (study_id, user_id)
);
create index project_memberships_user_idx on public.project_memberships (user_id);

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  role text not null check (role in ('editor', 'reviewer', 'viewer')),
  title_label text check (title_label is null or title_label in ('supervisor', 'co_investigator', 'collaborator', 'advisor', 'statistician')),
  -- sha-256 of the secret token, hex. The token itself is never stored.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  send_count int not null default 1,
  responded_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  -- Email delivery, recorded honestly: only provider_accepted means the email provider accepted the message.
  delivery_status text not null default 'not_attempted' check (delivery_status in ('not_attempted', 'provider_accepted', 'failed', 'not_configured')),
  delivery_error text,
  delivery_message_id text,
  delivery_at timestamptz
);
create unique index project_invitations_one_pending on public.project_invitations (study_id, email) where status = 'pending';
create index project_invitations_email_idx on public.project_invitations (email, created_at desc);
create index project_invitations_study_idx on public.project_invitations (study_id);
create index project_invitations_invited_by_idx on public.project_invitations (invited_by, created_at desc);
alter table public.project_memberships
  add constraint project_memberships_invitation_fk foreign key (invitation_id) references public.project_invitations (id) on delete set null;

create table public.collab_events (
  id bigint generated always as identity primary key,
  study_id uuid references public.studies (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_user uuid references public.profiles (id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index collab_events_study_idx on public.collab_events (study_id, created_at desc);

-- 3. Central permission functions ---------------------------------------------------------------------------------------------------

-- The plan that governs a project's collaboration limits. Today: the owner's plan. (Team projects override this in a later migration.)
create or replace function public.collab_project_plan(p_study uuid)
returns text language sql stable security definer set search_path = public, pg_temp
as $$ select public.billing_user_plan(s.owner_id) from public.studies s where s.id = p_study $$;

create or replace function public.collab_role_limit(p_plan text, p_role text)
returns int language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce((select max_per_project from public.collab_role_limits where plan_key = p_plan and role = p_role), 0) $$;

-- The single source of truth for "what may this account do on this project": 'owner', 'editor', 'reviewer', 'viewer' or null.
create or replace function public.study_role(p_study uuid, p_user uuid default auth.uid())
returns text language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_owner uuid; v_role text;
begin
  if p_user is null then return null; end if;
  -- Browser callers may only ask about themselves (so the function cannot be used to probe other people's access).
  if p_user is distinct from auth.uid() and current_setting('role', true) in ('anon', 'authenticated') then return null; end if;
  select owner_id into v_owner from public.studies where id = p_study;
  if v_owner is null then return null; end if;
  if v_owner = p_user then return 'owner'; end if;
  select role into v_role from public.project_memberships where study_id = p_study and user_id = p_user;
  if v_role is null then return null; end if;
  if public.collab_role_limit(public.collab_project_plan(p_study), v_role) <= 0 then return null; end if; -- dormant under the owner's plan
  return v_role;
end $$;

create or replace function public.can_read_study(p_study uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select public.study_role(p_study, auth.uid()) is not null $$;

create or replace function public.can_write_study(p_study uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.study_role(p_study, auth.uid()) in ('owner', 'editor'), false) $$;

-- Redefined so every existing "supervisor" policy now means "holds an active reviewer role". The name is kept so no policy changes meaning
-- silently elsewhere; what a supervisor LABEL on a profile says is irrelevant.
create or replace function public.is_study_supervisor(p_study_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.study_role(p_study_id, auth.uid()) = 'reviewer', false) $$;

-- Do two accounts share at least one project (as owner or member)? Used so people can see each other's name, nothing else.
create or replace function public.shares_study_with(p_profile uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
      from (select id as study_id, owner_id as user_id from public.studies
            union all select study_id, user_id from public.project_memberships) a
      join (select id as study_id, owner_id as user_id from public.studies
            union all select study_id, user_id from public.project_memberships) b using (study_id)
     where a.user_id = auth.uid() and b.user_id = p_profile
  )
$$;

-- 4. Database-level constraints (apply to every writer, including direct SQL) -------------------------------------------------------

create or replace function public.collab_membership_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_owner uuid; v_plan text; v_limit int; v_count int;
begin
  if current_user = 'postgres' and current_setting('collab.skip_limits', true) = 'on' then return new; end if; -- migrations copying history only
  select owner_id into v_owner from public.studies where id = new.study_id;
  if v_owner = new.user_id then raise exception 'owner_cannot_be_member' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and new.role = old.role then return new; end if;
  v_plan := public.collab_project_plan(new.study_id);
  v_limit := public.collab_role_limit(v_plan, new.role);
  if v_limit <= 0 then raise exception 'role_not_in_plan' using errcode = '23514', detail = new.role; end if;
  select count(*) into v_count from public.project_memberships
   where study_id = new.study_id and role = new.role and user_id <> new.user_id;
  if v_count >= v_limit then raise exception 'role_limit_reached' using errcode = '23514', detail = v_limit::text; end if;
  return new;
end $$;
create trigger project_memberships_guard before insert or update on public.project_memberships
  for each row execute function public.collab_membership_guard();

create or replace function public.collab_invitation_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_plan text; v_limit int; v_used int;
begin
  if current_user = 'postgres' and current_setting('collab.skip_limits', true) = 'on' then return new; end if;
  if tg_op = 'UPDATE' and (new.status <> 'pending' or new.role = old.role) then return new; end if;
  v_plan := public.collab_project_plan(new.study_id);
  v_limit := public.collab_role_limit(v_plan, new.role);
  if v_limit <= 0 then raise exception 'role_not_in_plan' using errcode = '23514', detail = new.role; end if;
  select (select count(*) from public.project_memberships where study_id = new.study_id and role = new.role)
       + (select count(*) from public.project_invitations where study_id = new.study_id and role = new.role and status = 'pending' and id <> new.id and expires_at > now())
    into v_used;
  if v_used >= v_limit then raise exception 'role_limit_reached' using errcode = '23514', detail = v_limit::text; end if;
  return new;
end $$;
create trigger project_invitations_guard before insert or update on public.project_invitations
  for each row execute function public.collab_invitation_guard();

-- Editors may change content but never the columns that lock, register or approve a protocol version.
create or replace function public.protocol_editor_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and public.study_role(new.study_id, auth.uid()) = 'editor' then
    if new.status is distinct from old.status or new.registered_at is distinct from old.registered_at
       or new.registration_method is distinct from old.registration_method or new.registered_by is distinct from old.registered_by
       or new.approved_by is distinct from old.approved_by or new.approval_requested_at is distinct from old.approval_requested_at then
      raise exception 'editor_cannot_lock_protocol' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger protocol_versions_editor_guard before update on public.protocol_versions
  for each row execute function public.protocol_editor_guard();

create or replace function public.protocol_delete_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and public.study_role(old.study_id, auth.uid()) is distinct from 'owner' then
    raise exception 'only_owner_can_delete_versions' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger protocol_versions_delete_guard before delete on public.protocol_versions
  for each row execute function public.protocol_delete_guard();

-- 5. Copy the older supervisor tables into the new model (nothing is deleted) ------------------------------------------------------

do $$
begin
  perform set_config('collab.skip_limits', 'on', true);
  insert into public.project_memberships (study_id, user_id, role, title_label, added_by, created_at)
  select ss.study_id, ss.supervisor_id, 'reviewer', 'supervisor', s.owner_id, ss.attached_at
    from public.study_supervisors ss join public.studies s on s.id = ss.study_id
  on conflict (study_id, user_id) do nothing;

  -- Pending legacy invitations stay pending: the old plaintext token is hashed, and they get a fresh expiry.
  insert into public.project_invitations (study_id, email, role, title_label, token_hash, status, invited_by, created_at, expires_at)
  select si.study_id, lower(trim(si.invited_email)), 'reviewer', 'supervisor',
         encode(sha256(convert_to(si.token, 'utf8')), 'hex'), 'pending', si.invited_by, si.created_at, now() + interval '14 days'
    from public.supervisor_invitations si
   where si.status = 'pending' and lower(trim(si.invited_email)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  on conflict do nothing;
end $$;

-- 6. Row level security ----------------------------------------------------------------------------------------------------------------

alter table public.project_memberships enable row level security;
alter table public.project_invitations enable row level security;
alter table public.collab_events enable row level security;
alter table public.collab_role_limits enable row level security;

revoke all on table public.project_memberships, public.project_invitations, public.collab_events, public.collab_role_limits from public, anon, authenticated;

-- Everyone on a project can see who else is on it. Only the server writes.
grant select on public.project_memberships to authenticated;
create policy project_memberships_read on public.project_memberships for select to authenticated
  using (user_id = auth.uid() or public.can_read_study(study_id));

-- The owner can see invitations to their project, without the token hash.
grant select (id, study_id, email, role, title_label, status, invited_by, created_at, expires_at, last_sent_at, send_count, responded_at,
              delivery_status, delivery_error, delivery_at) on public.project_invitations to authenticated;
create policy project_invitations_owner_read on public.project_invitations for select to authenticated
  using (public.is_study_owner(study_id));

grant select on public.collab_events to authenticated;
create policy collab_events_read on public.collab_events for select to authenticated
  using (study_id is not null and public.can_read_study(study_id));

grant select on public.collab_role_limits to authenticated;
create policy collab_role_limits_read on public.collab_role_limits for select to authenticated using (true);

-- 7. Rewire existing policies: members read; owners and editors write -----------------------------------------------------------------

-- studies: any active member can read; only the owner changes or deletes (studies_owner_all is unchanged).
drop policy if exists studies_supervisor_select on public.studies;
drop policy if exists studies_select_via_pending_invitation on public.studies;
create policy studies_member_select on public.studies for select using (public.can_read_study(id));

-- Content tables: owners AND editors write (policy was owner only), every member reads.
do $$
declare t record;
begin
  for t in select * from (values
    ('protocol_versions',   'protocol_versions_owner_all',   'study_id'),
    ('protocol_objectives', 'protocol_objectives_owner_all', 'public.study_id_for_protocol_version(protocol_version_id)'),
    ('protocol_variables',  'protocol_variables_owner_all',  'public.study_id_for_protocol_version(protocol_version_id)'),
    ('milestones',          'milestones_owner_all',          'study_id'),
    ('deviations',          'deviations_owner_all',          'study_id'),
    ('generated_outputs',   'generated_outputs_owner_all',   'public.study_id_for_protocol_version(protocol_version_id)'),
    ('deviation_reports',   'deviation_reports_owner_all',   'study_id'),
    ('manuscripts',         'manuscripts_owner_all',         'study_id'),
    ('reference_collections','reference_collections_owner_all','study_id'),
    ('saved_calculations',  'saved_calculations_owner_all',  'study_id'),
    ('study_references',    'study_references_owner_all',    'study_id')
  ) as x(tbl, pol, expr)
  loop
    execute format('alter policy %I on public.%I using (public.can_write_study(%s)) with check (public.can_write_study(%s))', t.pol, t.tbl, t.expr, t.expr);
  end loop;
end $$;

alter policy manuscript_versions_owner_select on public.manuscript_versions using (public.can_read_study(public.manuscript_study(manuscript_id)));
alter policy manuscript_versions_owner_insert on public.manuscript_versions with check (public.can_write_study(public.manuscript_study(manuscript_id)));
alter policy manuscript_versions_owner_delete_auto on public.manuscript_versions using (kind = 'auto' and public.can_write_study(public.manuscript_study(manuscript_id)));

-- Read policies that named supervisors now cover every active member (reviewer, viewer; editors already read through write policies).
do $$
declare t record;
begin
  for t in select * from (values
    ('amendments','amendments_supervisor_select','study_id'),
    ('deviation_reports','deviation_reports_supervisor_select','study_id'),
    ('deviations','deviations_supervisor_select','study_id'),
    ('generated_outputs','generated_outputs_supervisor_select','public.study_id_for_protocol_version(protocol_version_id)'),
    ('manuscript_versions','manuscript_versions_supervisor_select','public.manuscript_study(manuscript_id)'),
    ('manuscripts','manuscripts_supervisor_select','study_id'),
    ('milestones','milestones_supervisor_select','study_id'),
    ('protocol_objectives','protocol_objectives_supervisor_select','public.study_id_for_protocol_version(protocol_version_id)'),
    ('protocol_variables','protocol_variables_supervisor_select','public.study_id_for_protocol_version(protocol_version_id)'),
    ('protocol_versions','protocol_versions_supervisor_select','study_id'),
    ('reference_collections','reference_collections_supervisor_select','study_id'),
    ('saved_calculations','saved_calculations_supervisor_select','study_id'),
    ('study_references','study_references_supervisor_select','study_id')
  ) as x(tbl, pol, expr)
  loop
    execute format('alter policy %I on public.%I using (public.can_read_study(%s))', t.pol, t.tbl, t.expr);
  end loop;
end $$;

-- Profiles: see your own, and the name of anyone you share a project with.
drop policy if exists profiles_select_as_supervisor on public.profiles;
drop policy if exists profiles_select_as_student on public.profiles;
create policy profiles_select_shared on public.profiles for select using (public.shares_study_with(id));

-- Storage: protocol outputs (path starts with the study id) and manuscript figures.
drop policy if exists protocol_outputs_owner_all on storage.objects;
drop policy if exists protocol_outputs_supervisor_select on storage.objects;
create or replace function public.storage_study_of(p_name text) returns uuid language sql immutable as $$
  select case when (string_to_array(p_name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((string_to_array(p_name, '/'))[1])::uuid end
$$;
create policy protocol_outputs_write on storage.objects for all
  using (bucket_id = 'protocol-outputs' and public.storage_study_of(name) is not null and public.can_write_study(public.storage_study_of(name)))
  with check (bucket_id = 'protocol-outputs' and public.storage_study_of(name) is not null and public.can_write_study(public.storage_study_of(name)));
create policy protocol_outputs_read on storage.objects for select
  using (bucket_id = 'protocol-outputs' and public.storage_study_of(name) is not null and public.can_read_study(public.storage_study_of(name)));

drop policy if exists manuscript_figures_supervisor_select on storage.objects;
create policy manuscript_figures_member_select on storage.objects for select
  using (bucket_id = 'manuscript-figures' and public.figure_manuscript(name) is not null
         and public.can_read_study(public.manuscript_study(public.figure_manuscript(name))));
drop policy if exists manuscript_figures_owner_insert on storage.objects;
create policy manuscript_figures_owner_insert on storage.objects for insert
  with check (
    bucket_id = 'manuscript-figures'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.figure_manuscript(name) is not null
    and public.can_write_study(public.manuscript_study(public.figure_manuscript(name)))
    and public.figure_bytes_used(auth.uid()) < 52428800
  );

-- The manuscript functions check ownership on their error paths; make those checks mean "may write" too.
do $$
declare f record; v_def text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('save_manuscript', 'restore_manuscript_version') and pg_get_functiondef(p.oid) like '%is_study_owner%'
  loop
    v_def := replace(pg_get_functiondef(f.oid), 'public.is_study_owner(', 'public.can_write_study(');
    execute v_def;
  end loop;
end $$;

-- Close the legacy self-service paths: invitations are now accepted only by the server. Old tables are read-only history.
drop policy if exists supervisor_invitations_invitee_select on public.supervisor_invitations;
drop policy if exists supervisor_invitations_invitee_respond on public.supervisor_invitations;
drop policy if exists supervisor_invitations_student_all on public.supervisor_invitations;
drop policy if exists study_supervisors_owner_all on public.study_supervisors;
drop policy if exists study_supervisors_supervisor_insert_on_accept on public.study_supervisors;
drop policy if exists study_supervisors_supervisor_select on public.study_supervisors;
create policy supervisor_invitations_owner_read on public.supervisor_invitations for select using (public.is_study_owner(study_id));
create policy study_supervisors_member_read on public.study_supervisors for select using (public.can_read_study(study_id));
revoke insert, update, delete on public.supervisor_invitations, public.study_supervisors from anon, authenticated;
comment on table public.supervisor_invitations is 'Legacy, read-only. Replaced by project_invitations.';
comment on table public.study_supervisors is 'Legacy, read-only. Replaced by project_memberships.';

-- 8. Server functions (service role only; every function takes the acting user and checks it itself) -------------------------------

create or replace function public.collab_log(p_study uuid, p_actor uuid, p_action text, p_target uuid default null, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.collab_events (study_id, actor_id, action, target_user, meta) values (p_study, p_actor, p_action, p_target, coalesce(p_meta, '{}'::jsonb)) $$;

create or replace function public.collab_new_token() returns text language sql volatile
as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

create or replace function public.collab_hash_token(p_token text) returns text language sql immutable
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex') $$;

create or replace function public.collab_user_email(p_user uuid) returns text language sql stable security definer set search_path = public, pg_temp
as $$ select lower(email) from auth.users where id = p_user $$;

create or replace function public.collab_invite(p_actor uuid, p_study uuid, p_email text, p_role text, p_label text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text; v_id uuid; v_expires timestamptz; v_days int;
begin
  if public.study_role(p_study, p_actor) is distinct from 'owner' then raise exception 'not_owner' using errcode = '42501'; end if;
  if p_role not in ('editor', 'reviewer', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if v_email = public.collab_user_email(p_actor) then raise exception 'cannot_invite_self' using errcode = '22023'; end if;
  if exists (select 1 from public.project_memberships m where m.study_id = p_study and public.collab_user_email(m.user_id) = v_email) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  if exists (select 1 from public.project_invitations where study_id = p_study and email = v_email and status = 'pending' and expires_at > now()) then
    raise exception 'already_invited' using errcode = '23505';
  end if;
  -- Abuse limits
  if (select count(*) from public.project_invitations where invited_by = p_actor and created_at > now() - interval '24 hours')
       >= public.billing_setting_num('collab_invites_per_owner_per_day') then raise exception 'rate_limited_owner' using errcode = 'P0001'; end if;
  if (select count(*) from public.project_invitations where email = v_email and created_at > now() - interval '24 hours')
       >= public.billing_setting_num('collab_invites_per_email_per_day') then raise exception 'rate_limited_recipient' using errcode = 'P0001'; end if;
  if (select count(*) from public.project_invitations where study_id = p_study and status = 'pending' and expires_at > now())
       >= public.billing_setting_num('collab_pending_invites_per_project') then raise exception 'too_many_pending' using errcode = 'P0001'; end if;
  -- A stale pending row for the same email blocks the unique index; close it first.
  update public.project_invitations set status = 'revoked', responded_at = now()
   where study_id = p_study and email = v_email and status = 'pending' and expires_at <= now();

  v_days := public.billing_setting_num('collab_invite_expiry_days')::int;
  v_expires := now() + make_interval(days => v_days);
  v_token := public.collab_new_token();
  insert into public.project_invitations (study_id, email, role, title_label, token_hash, invited_by, expires_at)
  values (p_study, v_email, p_role, p_label, public.collab_hash_token(v_token), p_actor, v_expires)
  returning id into v_id;
  perform public.collab_log(p_study, p_actor, 'invitation_created', null, jsonb_build_object('role', p_role, 'invitation', v_id));
  return jsonb_build_object('invitation_id', v_id, 'token', v_token, 'email', v_email, 'role', p_role, 'expires_at', v_expires);
end $$;

-- Resending issues a NEW token (the old one stops working) because the original is unrecoverable by design.
create or replace function public.collab_resend(p_actor uuid, p_invitation uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.project_invitations%rowtype; v_token text; v_expires timestamptz;
begin
  select * into i from public.project_invitations where id = p_invitation for update;
  if not found or public.study_role(i.study_id, p_actor) is distinct from 'owner' then raise exception 'not_owner' using errcode = '42501'; end if;
  if i.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if i.last_sent_at > now() - make_interval(mins => public.billing_setting_num('collab_resend_cooldown_minutes')::int) then
    raise exception 'resend_too_soon' using errcode = 'P0001'; end if;
  if i.send_count > public.billing_setting_num('collab_max_resends') then raise exception 'resend_limit' using errcode = 'P0001'; end if;
  if (select count(*) from public.project_invitations where email = i.email and last_sent_at > now() - interval '24 hours')
       > public.billing_setting_num('collab_invites_per_email_per_day') + 2 then raise exception 'rate_limited_recipient' using errcode = 'P0001'; end if;
  v_token := public.collab_new_token();
  v_expires := now() + make_interval(days => public.billing_setting_num('collab_invite_expiry_days')::int);
  update public.project_invitations
     set token_hash = public.collab_hash_token(v_token), expires_at = v_expires, last_sent_at = now(), send_count = send_count + 1,
         delivery_status = 'not_attempted', delivery_error = null, delivery_message_id = null, delivery_at = null
   where id = p_invitation;
  perform public.collab_log(i.study_id, p_actor, 'invitation_resent', null, jsonb_build_object('invitation', p_invitation));
  return jsonb_build_object('invitation_id', p_invitation, 'token', v_token, 'email', i.email, 'role', i.role, 'expires_at', v_expires);
end $$;

create or replace function public.collab_revoke(p_actor uuid, p_invitation uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.project_invitations%rowtype;
begin
  select * into i from public.project_invitations where id = p_invitation for update;
  if not found or public.study_role(i.study_id, p_actor) is distinct from 'owner' then raise exception 'not_owner' using errcode = '42501'; end if;
  if i.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  update public.project_invitations set status = 'revoked', responded_at = now() where id = p_invitation;
  perform public.collab_log(i.study_id, p_actor, 'invitation_revoked', null, jsonb_build_object('invitation', p_invitation));
end $$;

create or replace function public.collab_set_delivery(p_invitation uuid, p_status text, p_error text default null, p_message_id text default null)
returns void language sql security definer set search_path = public, pg_temp
as $$
  update public.project_invitations
     set delivery_status = p_status, delivery_error = left(p_error, 300), delivery_message_id = p_message_id, delivery_at = now()
   where id = p_invitation and p_status in ('provider_accepted', 'failed', 'not_configured')
$$;

-- Shared by accept-by-token and accept-by-id.
create or replace function public.collab_accept_row(p_actor uuid, p_invitation uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.project_invitations%rowtype; v_email text;
begin
  select * into i from public.project_invitations where id = p_invitation for update;
  if not found then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
  v_email := public.collab_user_email(p_actor);
  if v_email is null or v_email <> i.email then raise exception 'invitation_invalid' using errcode = 'P0002'; end if; -- same message as unknown, on purpose
  -- Accepting twice is harmless only while the membership still exists; after removal the used link must not work again.
  if i.status = 'accepted' and i.accepted_by = p_actor and exists (select 1 from public.project_memberships where study_id = i.study_id and user_id = p_actor) then
    return jsonb_build_object('study_id', i.study_id, 'role', i.role, 'already', true); end if;
  if i.status <> 'pending' then raise exception 'invitation_closed' using errcode = 'P0001'; end if;
  if i.expires_at <= now() then raise exception 'invitation_expired' using errcode = 'P0001'; end if;
  if public.study_role(i.study_id, p_actor) = 'owner' then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
  -- Re-checks plan limits (the guard trigger) and creates or updates the one membership row.
  insert into public.project_memberships (study_id, user_id, role, title_label, added_by, invitation_id)
  values (i.study_id, p_actor, i.role, i.title_label, i.invited_by, i.id)
  on conflict (study_id, user_id) do update set role = excluded.role, title_label = excluded.title_label, invitation_id = excluded.invitation_id;
  update public.project_invitations set status = 'accepted', responded_at = now(), accepted_by = p_actor where id = i.id;
  perform public.collab_log(i.study_id, p_actor, 'member_joined', p_actor, jsonb_build_object('role', i.role));
  return jsonb_build_object('study_id', i.study_id, 'role', i.role, 'already', false);
end $$;

create or replace function public.collab_accept(p_actor uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  select id into v_id from public.project_invitations where token_hash = public.collab_hash_token(p_token);
  if v_id is null then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
  return public.collab_accept_row(p_actor, v_id);
end $$;

create or replace function public.collab_decline(p_actor uuid, p_invitation uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.project_invitations%rowtype;
begin
  select * into i from public.project_invitations where id = p_invitation for update;
  if not found or public.collab_user_email(p_actor) is distinct from i.email then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
  if i.status <> 'pending' then raise exception 'invitation_closed' using errcode = 'P0001'; end if;
  update public.project_invitations set status = 'declined', responded_at = now() where id = i.id;
  perform public.collab_log(i.study_id, p_actor, 'invitation_declined', p_actor, jsonb_build_object('invitation', i.id));
end $$;

-- What the accept page shows. A signed-in account whose email does not match learns nothing about the project.
create or replace function public.collab_invitation_preview(p_actor uuid, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare i public.project_invitations%rowtype; v_title text; v_from text;
begin
  select * into i from public.project_invitations where token_hash = public.collab_hash_token(p_token);
  if not found or public.collab_user_email(p_actor) is distinct from i.email then return jsonb_build_object('state', 'invalid'); end if;
  select title into v_title from public.studies where id = i.study_id;
  select full_name into v_from from public.profiles where id = i.invited_by;
  return jsonb_build_object('state', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    'invitation_id', i.id, 'study_title', v_title, 'role', i.role, 'title_label', i.title_label, 'invited_by', v_from, 'expires_at', i.expires_at);
end $$;

create or replace function public.collab_my_invitations(p_actor uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('invitation_id', i.id, 'study_title', s.title, 'role', i.role, 'title_label', i.title_label,
           'invited_by', p.full_name, 'expires_at', i.expires_at) order by i.created_at desc), '[]'::jsonb)
    from public.project_invitations i join public.studies s on s.id = i.study_id left join public.profiles p on p.id = i.invited_by
   where i.status = 'pending' and i.expires_at > now() and i.email = public.collab_user_email(p_actor)
$$;

create or replace function public.collab_accept_by_id(p_actor uuid, p_invitation uuid)
returns jsonb language sql security definer set search_path = public, pg_temp
as $$ select public.collab_accept_row(p_actor, p_invitation) $$;

create or replace function public.collab_remove_member(p_actor uuid, p_study uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_actor <> p_user and public.study_role(p_study, p_actor) is distinct from 'owner' then raise exception 'not_owner' using errcode = '42501'; end if;
  delete from public.project_memberships where study_id = p_study and user_id = p_user;
  if not found then raise exception 'not_a_member' using errcode = 'P0002'; end if;
  perform public.collab_log(p_study, p_actor, case when p_actor = p_user then 'member_left' else 'member_removed' end, p_user);
end $$;

create or replace function public.collab_change_role(p_actor uuid, p_study uuid, p_user uuid, p_role text, p_label text default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.study_role(p_study, p_actor) is distinct from 'owner' then raise exception 'not_owner' using errcode = '42501'; end if;
  if p_role not in ('editor', 'reviewer', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  update public.project_memberships set role = p_role, title_label = coalesce(p_label, title_label) where study_id = p_study and user_id = p_user;
  if not found then raise exception 'not_a_member' using errcode = 'P0002'; end if;
  perform public.collab_log(p_study, p_actor, 'member_role_changed', p_user, jsonb_build_object('role', p_role));
end $$;

-- People on a project. The owner also gets pending invitations (without tokens).
create or replace function public.collab_project_people(p_actor uuid, p_study uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text := public.study_role(p_study, p_actor); v_plan text; v_owner jsonb; v_members jsonb; v_invites jsonb;
begin
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_plan := public.collab_project_plan(p_study);
  select jsonb_build_object('user_id', p.id, 'full_name', p.full_name, 'institution', p.institution) into v_owner
    from public.studies s join public.profiles p on p.id = s.owner_id where s.id = p_study;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', p.full_name, 'institution', p.institution, 'role', m.role,
           'title_label', m.title_label, 'joined_at', m.created_at,
           'active', public.collab_role_limit(v_plan, m.role) > 0) order by m.created_at), '[]'::jsonb) into v_members
    from public.project_memberships m join public.profiles p on p.id = m.user_id where m.study_id = p_study;
  if v_role = 'owner' then
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'title_label', i.title_label, 'status', i.status,
             'created_at', i.created_at, 'expires_at', i.expires_at, 'send_count', i.send_count, 'delivery_status', i.delivery_status,
             'delivery_error', i.delivery_error, 'expired', i.expires_at <= now()) order by i.created_at desc), '[]'::jsonb) into v_invites
      from public.project_invitations i where i.study_id = p_study and i.status = 'pending';
  else v_invites := '[]'::jsonb; end if;
  return jsonb_build_object('your_role', v_role, 'plan', v_plan, 'owner', v_owner, 'members', v_members, 'invitations', v_invites,
    'limits', (select coalesce(jsonb_object_agg(l.role, jsonb_build_object('max', l.max_per_project,
        'used', (select count(*) from public.project_memberships m where m.study_id = p_study and m.role = l.role)
              + (select count(*) from public.project_invitations i where i.study_id = p_study and i.role = l.role and i.status = 'pending' and i.expires_at > now()))), '{}'::jsonb)
        from public.collab_role_limits l where l.plan_key = v_plan));
end $$;

-- "Shared with me": projects the account is a member of (not owned), newest activity first.
create or replace function public.collab_shared_with(p_actor uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('study_id', s.id, 'title', s.title, 'role', m.role, 'title_label', m.title_label,
           'owner_name', o.full_name, 'status', s.status, 'last_activity_at', s.last_activity_at, 'joined_at', m.created_at,
           'active', public.study_role(s.id, p_actor) is not null) order by s.last_activity_at desc), '[]'::jsonb)
    from public.project_memberships m join public.studies s on s.id = m.study_id join public.profiles o on o.id = s.owner_id
   where m.user_id = p_actor
$$;

-- Privileges: browser roles get nothing; the server (service role) gets the functions.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'collab\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
-- Helpers used inside row level security policies must stay callable by signed-in users.
grant execute on function public.study_role(uuid, uuid), public.can_read_study(uuid), public.can_write_study(uuid),
  public.is_study_supervisor(uuid), public.shares_study_with(uuid), public.storage_study_of(text) to anon, authenticated, service_role;
