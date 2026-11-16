-- Collaboration, stage 3: team workspaces.
--
-- Design:
--   * A team is a named group. Team roles: owner, administrator, member, guest. Owner, administrator and member hold a PAID seat; a guest
--     holds a guest seat (external reviewers and advisers). Seat and guest limits are data (team_limits), and the entitlement function
--     team_entitlements() is the single place that decides them (stage 5 connects it to the Team subscription).
--   * Team membership NEVER grants access to a project. A team project is a normal project (studies.team_id) whose people are chosen
--     explicitly through project_memberships, exactly as in stage 1. Team owners and administrators see a project's title, status and
--     headcount on the team dashboard, never its content.
--   * Editor and viewer roles on a team project need a paid seat; reviewers may be guests or outside supervisors.
--   * Shared references are associations to the original reference row, not copies. Private notes and tags are never shared.
--   * Shared documents live in a private storage bucket; reading needs a team seat (or a seat on the attached project), enforced by
--     storage policies, so removing someone removes their access to the files at once.

-- 1. Tables ------------------------------------------------------------------------------------------------------------------------

insert into public.billing_settings (key, value_num, description) values
  ('teams_owned_per_user', 3, 'Most teams one account may own.'),
  ('team_documents_max_mb', 10, 'Largest single team document, in megabytes.')
on conflict (key) do nothing;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'administrator', 'member', 'guest')),
  seat_type text not null check (seat_type in ('paid', 'guest')),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, user_id),
  check ((role = 'guest') = (seat_type = 'guest'))
);
create unique index team_one_owner on public.team_memberships (team_id) where role = 'owner';
create index team_memberships_user_idx on public.team_memberships (user_id);

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  role text not null check (role in ('administrator', 'member', 'guest')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  send_count int not null default 1,
  responded_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  delivery_status text not null default 'not_attempted' check (delivery_status in ('not_attempted', 'provider_accepted', 'failed', 'not_configured')),
  delivery_error text,
  delivery_message_id text,
  delivery_at timestamptz
);
create unique index team_invitations_one_pending on public.team_invitations (team_id, email) where status = 'pending';
create index team_invitations_email_idx on public.team_invitations (email, created_at desc);

create table public.team_limits (
  plan_key text not null check (plan_key in ('unsubscribed', 'team')),
  limit_key text not null check (limit_key in ('max_paid_seats', 'max_guests', 'max_projects', 'max_storage_mb')),
  value int not null check (value >= 0),
  primary key (plan_key, limit_key)
);
comment on table public.team_limits is 'Team entitlements by state. "unsubscribed" is a team with no active Team plan; "team" is the cap when a Team subscription is active (paid seats then come from the subscription). Edit with SQL.';
insert into public.team_limits values
  ('unsubscribed', 'max_paid_seats', 1), ('unsubscribed', 'max_guests', 2), ('unsubscribed', 'max_projects', 3), ('unsubscribed', 'max_storage_mb', 50),
  ('team', 'max_paid_seats', 25), ('team', 'max_guests', 15), ('team', 'max_projects', 200), ('team', 'max_storage_mb', 5000);

alter table public.collab_events add column team_id uuid references public.teams (id) on delete cascade;
create index collab_events_team_idx on public.collab_events (team_id, created_at desc);

alter table public.studies add column team_id uuid references public.teams (id) on delete restrict;
create index studies_team_idx on public.studies (team_id) where team_id is not null;

-- 2. Entitlements and permission helpers -----------------------------------------------------------------------------------------------

-- The single source of truth for what a team may have. Stage 5 replaces the state lookup with the real subscription.
create or replace function public.team_entitlements(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_state text := 'unsubscribed'; v_paid int; v_guests int; v_projects int; v_storage int;
begin
  select value into v_paid from public.team_limits where plan_key = case when v_state = 'active' then 'team' else 'unsubscribed' end and limit_key = 'max_paid_seats';
  select value into v_guests from public.team_limits where plan_key = case when v_state = 'active' then 'team' else 'unsubscribed' end and limit_key = 'max_guests';
  select value into v_projects from public.team_limits where plan_key = case when v_state = 'active' then 'team' else 'unsubscribed' end and limit_key = 'max_projects';
  select value into v_storage from public.team_limits where plan_key = case when v_state = 'active' then 'team' else 'unsubscribed' end and limit_key = 'max_storage_mb';
  return jsonb_build_object('state', v_state, 'max_paid_seats', coalesce(v_paid, 0), 'max_guests', coalesce(v_guests, 0), 'max_projects', coalesce(v_projects, 0), 'max_storage_mb', coalesce(v_storage, 0));
end $$;

create or replace function public.team_role(p_team uuid, p_user uuid default auth.uid())
returns text language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v text;
begin
  if p_user is null then return null; end if;
  if p_user is distinct from auth.uid() and current_setting('role', true) in ('anon', 'authenticated') then return null; end if;
  select m.role into v from public.team_memberships m join public.teams t on t.id = m.team_id where m.team_id = p_team and m.user_id = p_user and t.archived_at is null;
  return v;
end $$;

create or replace function public.team_is_paid_member(p_team uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select coalesce(public.team_role(p_team, p_user) in ('owner', 'administrator', 'member'), false) $$;

create or replace function public.team_is_member(p_team uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.team_role(p_team, auth.uid()) is not null $$;

-- Teams that share a person (so names can be shown inside a team).
create or replace function public.shares_team_with(p_profile uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select auth.uid() is not null and exists (select 1 from public.team_memberships a join public.team_memberships b using (team_id) where a.user_id = auth.uid() and b.user_id = p_profile) $$;

-- A team project follows the team's collaboration limits when the team has an active Team plan, otherwise the owner's own plan.
create or replace function public.collab_project_plan(p_study uuid)
returns text language sql stable security definer set search_path = public, pg_temp
as $$
  select case when s.team_id is not null and public.team_entitlements(s.team_id) ->> 'state' = 'active' then 'team' else public.billing_user_plan(s.owner_id) end
    from public.studies s where s.id = p_study
$$;
insert into public.collab_role_limits (plan_key, role, max_per_project) values ('team', 'reviewer', 10), ('team', 'editor', 20), ('team', 'viewer', 20);

-- 3. Database constraints ---------------------------------------------------------------------------------------------------------------

create or replace function public.team_membership_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_ent jsonb; v_paid int; v_guests int;
begin
  if current_user = 'postgres' and current_setting('collab.skip_limits', true) = 'on' then return new; end if;
  if tg_op = 'UPDATE' and new.seat_type = old.seat_type and new.role = old.role then return new; end if;
  v_ent := public.team_entitlements(new.team_id);
  select count(*) filter (where seat_type = 'paid'), count(*) filter (where seat_type = 'guest') into v_paid, v_guests
    from public.team_memberships where team_id = new.team_id and id <> new.id;
  if new.seat_type = 'paid' and v_paid >= (v_ent ->> 'max_paid_seats')::int then raise exception 'no_paid_seat' using errcode = '23514'; end if;
  if new.seat_type = 'guest' and v_guests >= (v_ent ->> 'max_guests')::int then raise exception 'no_guest_seat' using errcode = '23514'; end if;
  return new;
end $$;
create trigger team_memberships_guard before insert or update on public.team_memberships for each row execute function public.team_membership_guard();

-- Team projects: only a paid member may create one in their own name, within the team's project limit; the team cannot be changed afterwards.
create or replace function public.studies_team_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_max int;
begin
  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id and auth.uid() is not null then raise exception 'team_id_immutable' using errcode = '42501'; end if;
    return new;
  end if;
  if new.team_id is null then return new; end if;
  if auth.uid() is not null and (new.owner_id <> auth.uid() or not public.team_is_paid_member(new.team_id, auth.uid())) then raise exception 'not_team_member' using errcode = '42501'; end if;
  if not exists (select 1 from public.team_memberships where team_id = new.team_id and user_id = new.owner_id and seat_type = 'paid') then raise exception 'not_team_member' using errcode = '42501'; end if;
  v_max := (public.team_entitlements(new.team_id) ->> 'max_projects')::int;
  if (select count(*) from public.studies where team_id = new.team_id) >= v_max then raise exception 'team_project_limit' using errcode = 'P0001', detail = v_max::text; end if;
  return new;
end $$;
create trigger studies_team_guard before insert or update on public.studies for each row execute function public.studies_team_guard();

-- Team projects do not count against the owner's personal project limit.
create or replace function public.studies_enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_max int; v_plan text;
begin
  if new.team_id is not null then return new; end if;
  v_plan := public.billing_user_plan(new.owner_id);
  select max_projects into v_max from public.plans where plan_key = v_plan;
  if v_max is not null and (select count(*) from public.studies where owner_id = new.owner_id and team_id is null) >= v_max then
    raise exception 'plan_project_limit' using errcode = 'P0001', detail = v_max::text, hint = v_plan;
  end if;
  return new;
end $$;

-- On a team project, editor and viewer invitations may only go to paid team members.
create or replace function public.collab_invitation_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_plan text; v_limit int; v_used int; v_team uuid;
begin
  if current_user = 'postgres' and current_setting('collab.skip_limits', true) = 'on' then return new; end if;
  if tg_op = 'UPDATE' and (new.status <> 'pending' or new.role = old.role) then return new; end if;
  select team_id into v_team from public.studies where id = new.study_id;
  if v_team is not null and new.role in ('editor', 'viewer')
     and not exists (select 1 from public.team_memberships m where m.team_id = v_team and m.seat_type = 'paid' and public.collab_user_email(m.user_id) = new.email) then
    raise exception 'team_seat_required' using errcode = '23514';
  end if;
  v_plan := public.collab_project_plan(new.study_id);
  v_limit := public.collab_role_limit(v_plan, new.role);
  if v_limit <= 0 then raise exception 'role_not_in_plan' using errcode = '23514', detail = new.role; end if;
  select (select count(*) from public.project_memberships where study_id = new.study_id and role = new.role)
       + (select count(*) from public.project_invitations where study_id = new.study_id and role = new.role and status = 'pending' and id <> new.id and expires_at > now())
    into v_used;
  if v_used >= v_limit then raise exception 'role_limit_reached' using errcode = '23514', detail = v_limit::text; end if;
  return new;
end $$;

-- On a team project, editor and viewer roles need a paid seat; reviewers can be guests or outside supervisors.
create or replace function public.collab_membership_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_owner uuid; v_team uuid; v_plan text; v_limit int; v_count int;
begin
  if current_user = 'postgres' and current_setting('collab.skip_limits', true) = 'on' then return new; end if;
  select owner_id, team_id into v_owner, v_team from public.studies where id = new.study_id;
  if v_owner = new.user_id then raise exception 'owner_cannot_be_member' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' and new.role = old.role then return new; end if;
  if v_team is not null and new.role in ('editor', 'viewer')
     and not exists (select 1 from public.team_memberships where team_id = v_team and user_id = new.user_id and seat_type = 'paid') then
    raise exception 'team_seat_required' using errcode = '23514';
  end if;
  v_plan := public.collab_project_plan(new.study_id);
  v_limit := public.collab_role_limit(v_plan, new.role);
  if v_limit <= 0 then raise exception 'role_not_in_plan' using errcode = '23514', detail = new.role; end if;
  select count(*) into v_count from public.project_memberships where study_id = new.study_id and role = new.role and user_id <> new.user_id;
  if v_count >= v_limit then raise exception 'role_limit_reached' using errcode = '23514', detail = v_limit::text; end if;
  return new;
end $$;

-- A person leaving the team loses every project role they held on that team's projects.
create or replace function public.team_member_removed() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.project_memberships pm using public.studies s
   where pm.study_id = s.id and s.team_id = old.team_id and pm.user_id = old.user_id;
  delete from public.study_reference_links l using public.team_references tr
   where l.team_reference_id = tr.id and tr.team_id = old.team_id and l.linked_by = old.user_id;
  return old;
end $$;

-- 4. Shared references and documents ----------------------------------------------------------------------------------------------------

create table public.team_references (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  reference_id uuid not null references public.study_references (id) on delete cascade,
  shared_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, reference_id)
);
create table public.study_reference_links (
  study_id uuid not null references public.studies (id) on delete cascade,
  team_reference_id uuid not null references public.team_references (id) on delete cascade,
  linked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (study_id, team_reference_id)
);
create index study_reference_links_ref_idx on public.study_reference_links (team_reference_id);
create trigger team_memberships_removed after delete on public.team_memberships for each row execute function public.team_member_removed();

create table public.team_documents (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  study_id uuid references public.studies (id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 200),
  mime text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready')),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index team_documents_team_idx on public.team_documents (team_id, created_at desc) where deleted_at is null;

create or replace function public.team_doc_can_read(p_team uuid, p_study uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select public.team_is_paid_member(p_team, auth.uid()) or (p_study is not null and public.can_read_study(p_study)) $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-documents', 'team-documents', false, 10485760, array['application/pdf', 'text/plain', 'text/csv', 'image/png', 'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Reading a file needs a ready, undeleted record AND a seat (or a seat on the attached project). Uploading needs the pending record this user made.
-- The checks live in functions so the policies do not need column privileges on team_documents.storage_path.
create or replace function public.team_doc_storage_can_read(p_name text) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.team_documents d where d.storage_path = p_name and d.status = 'ready' and d.deleted_at is null and public.team_doc_can_read(d.team_id, d.study_id)) $$;
create or replace function public.team_doc_storage_can_insert(p_name text) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.team_documents d where d.storage_path = p_name and d.status = 'pending' and d.uploaded_by = auth.uid() and public.team_is_paid_member(d.team_id, auth.uid())) $$;

create policy team_documents_storage_read on storage.objects for select
  using (bucket_id = 'team-documents' and public.team_doc_storage_can_read(name));
create policy team_documents_storage_insert on storage.objects for insert
  with check (bucket_id = 'team-documents' and public.team_doc_storage_can_insert(name));

-- 5. Row level security ------------------------------------------------------------------------------------------------------------------

alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.team_invitations enable row level security;
alter table public.team_limits enable row level security;
alter table public.team_references enable row level security;
alter table public.study_reference_links enable row level security;
alter table public.team_documents enable row level security;
revoke all on table public.teams, public.team_memberships, public.team_invitations, public.team_limits, public.team_references, public.study_reference_links, public.team_documents from public, anon, authenticated;

grant select on public.teams, public.team_memberships, public.team_limits, public.study_reference_links to authenticated;
create policy teams_member_read on public.teams for select to authenticated using (public.team_is_member(id));
create policy team_memberships_read on public.team_memberships for select to authenticated using (user_id = auth.uid() or public.team_is_paid_member(team_id));
create policy team_limits_read on public.team_limits for select to authenticated using (true);
create policy study_reference_links_read on public.study_reference_links for select to authenticated using (public.can_read_study(study_id));

grant select (id, team_id, email, role, status, invited_by, created_at, expires_at, last_sent_at, send_count, responded_at, delivery_status, delivery_error, delivery_at) on public.team_invitations to authenticated;
create policy team_invitations_admin_read on public.team_invitations for select to authenticated using (public.team_role(team_id) in ('owner', 'administrator'));
grant select on public.team_references to authenticated;
create policy team_references_read on public.team_references for select to authenticated using (public.team_is_paid_member(team_id));
grant select (id, team_id, study_id, name, mime, size_bytes, status, uploaded_by, created_at, deleted_at) on public.team_documents to authenticated;
create policy team_documents_read on public.team_documents for select to authenticated using (deleted_at is null and status = 'ready' and public.team_doc_can_read(team_id, study_id));

-- Members can see each other's names inside a team.
create policy profiles_select_team on public.profiles for select using (public.shares_team_with(id));

-- 6. Server functions -----------------------------------------------------------------------------------------------------------------------

create or replace function public.team_log(p_team uuid, p_actor uuid, p_action text, p_target uuid default null, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.collab_events (team_id, actor_id, action, target_user, meta) values (p_team, p_actor, p_action, p_target, coalesce(p_meta, '{}'::jsonb)) $$;

create or replace function public.team_create(p_actor uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if (select count(*) from public.team_memberships where user_id = p_actor and role = 'owner') >= public.billing_setting_num('teams_owned_per_user') then raise exception 'too_many_teams' using errcode = 'P0001'; end if;
  insert into public.teams (name, created_by) values (v_name, p_actor) returning id into v_id;
  insert into public.team_memberships (team_id, user_id, role, seat_type, added_by) values (v_id, p_actor, 'owner', 'paid', p_actor);
  perform public.team_log(v_id, p_actor, 'team_created');
  return v_id;
end $$;

create or replace function public.team_rename(p_actor uuid, p_team uuid, p_name text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if public.team_role_of(p_team, p_actor) is distinct from 'owner' then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'invalid_name' using errcode = '22023'; end if;
  update public.teams set name = btrim(p_name) where id = p_team;
  perform public.team_log(p_team, p_actor, 'team_renamed');
end $$;

-- Role of an account in a team, called from server functions that act for p_actor.
create or replace function public.team_role_of(p_team uuid, p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp
as $$ select m.role from public.team_memberships m join public.teams t on t.id = m.team_id where m.team_id = p_team and m.user_id = p_user and t.archived_at is null $$;

create or replace function public.team_seat_usage(p_team uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'paid_used', (select count(*) from public.team_memberships where team_id = p_team and seat_type = 'paid'),
    'paid_invited', (select count(*) from public.team_invitations where team_id = p_team and status = 'pending' and expires_at > now() and role <> 'guest'),
    'guests_used', (select count(*) from public.team_memberships where team_id = p_team and seat_type = 'guest'),
    'guests_invited', (select count(*) from public.team_invitations where team_id = p_team and status = 'pending' and expires_at > now() and role = 'guest'))
$$;

create or replace function public.team_invite(p_actor uuid, p_team uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_role text := public.team_role_of(p_team, p_actor); v_ent jsonb := public.team_entitlements(p_team); v_use jsonb := public.team_seat_usage(p_team);
        v_token text; v_id uuid; v_expires timestamptz;
begin
  if coalesce(v_role, '') not in ('owner', 'administrator') then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if p_role not in ('administrator', 'member', 'guest') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_role = 'administrator' and v_role <> 'owner' then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'invalid_email' using errcode = '22023'; end if;
  if exists (select 1 from public.team_memberships m where m.team_id = p_team and public.collab_user_email(m.user_id) = v_email) then raise exception 'already_member' using errcode = '23505'; end if;
  if exists (select 1 from public.team_invitations where team_id = p_team and email = v_email and status = 'pending' and expires_at > now()) then raise exception 'already_invited' using errcode = '23505'; end if;
  if p_role = 'guest' then
    if (v_use ->> 'guests_used')::int + (v_use ->> 'guests_invited')::int >= (v_ent ->> 'max_guests')::int then raise exception 'no_guest_seat' using errcode = 'P0001'; end if;
  elsif (v_use ->> 'paid_used')::int + (v_use ->> 'paid_invited')::int >= (v_ent ->> 'max_paid_seats')::int then raise exception 'no_paid_seat' using errcode = 'P0001'; end if;
  if (select count(*) from public.team_invitations where invited_by = p_actor and created_at > now() - interval '24 hours')
     + (select count(*) from public.project_invitations where invited_by = p_actor and created_at > now() - interval '24 hours') >= public.billing_setting_num('collab_invites_per_owner_per_day') then raise exception 'rate_limited_owner' using errcode = 'P0001'; end if;
  if (select count(*) from public.team_invitations where email = v_email and created_at > now() - interval '24 hours')
     + (select count(*) from public.project_invitations where email = v_email and created_at > now() - interval '24 hours') >= public.billing_setting_num('collab_invites_per_email_per_day') then raise exception 'rate_limited_recipient' using errcode = 'P0001'; end if;
  update public.team_invitations set status = 'revoked', responded_at = now() where team_id = p_team and email = v_email and status = 'pending' and expires_at <= now();
  v_token := public.collab_new_token();
  v_expires := now() + make_interval(days => public.billing_setting_num('collab_invite_expiry_days')::int);
  insert into public.team_invitations (team_id, email, role, token_hash, invited_by, expires_at) values (p_team, v_email, p_role, public.collab_hash_token(v_token), p_actor, v_expires) returning id into v_id;
  perform public.team_log(p_team, p_actor, 'team_invitation_created', null, jsonb_build_object('role', p_role));
  return jsonb_build_object('invitation_id', v_id, 'token', v_token, 'email', v_email, 'role', p_role, 'expires_at', v_expires);
end $$;

create or replace function public.team_resend(p_actor uuid, p_invitation uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.team_invitations%rowtype; v_token text; v_expires timestamptz;
begin
  select * into i from public.team_invitations where id = p_invitation for update;
  if not found or coalesce(public.team_role_of(i.team_id, p_actor), '') not in ('owner', 'administrator') then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if i.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  if i.last_sent_at > now() - make_interval(mins => public.billing_setting_num('collab_resend_cooldown_minutes')::int) then raise exception 'resend_too_soon' using errcode = 'P0001'; end if;
  if i.send_count > public.billing_setting_num('collab_max_resends') then raise exception 'resend_limit' using errcode = 'P0001'; end if;
  v_token := public.collab_new_token();
  v_expires := now() + make_interval(days => public.billing_setting_num('collab_invite_expiry_days')::int);
  update public.team_invitations set token_hash = public.collab_hash_token(v_token), expires_at = v_expires, last_sent_at = now(), send_count = send_count + 1,
    delivery_status = 'not_attempted', delivery_error = null, delivery_message_id = null, delivery_at = null where id = p_invitation;
  return jsonb_build_object('invitation_id', p_invitation, 'token', v_token, 'email', i.email, 'role', i.role, 'expires_at', v_expires);
end $$;

create or replace function public.team_revoke(p_actor uuid, p_invitation uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.team_invitations%rowtype;
begin
  select * into i from public.team_invitations where id = p_invitation for update;
  if not found or coalesce(public.team_role_of(i.team_id, p_actor), '') not in ('owner', 'administrator') then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if i.status <> 'pending' then raise exception 'not_pending' using errcode = 'P0001'; end if;
  update public.team_invitations set status = 'revoked', responded_at = now() where id = p_invitation;
  perform public.team_log(i.team_id, p_actor, 'team_invitation_revoked');
end $$;

create or replace function public.team_set_delivery(p_invitation uuid, p_status text, p_error text default null, p_message_id text default null)
returns void language sql security definer set search_path = public, pg_temp
as $$ update public.team_invitations set delivery_status = p_status, delivery_error = left(p_error, 300), delivery_message_id = p_message_id, delivery_at = now()
       where id = p_invitation and p_status in ('provider_accepted', 'failed', 'not_configured') $$;

create or replace function public.team_accept_row(p_actor uuid, p_invitation uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare i public.team_invitations%rowtype; v_email text;
begin
  select * into i from public.team_invitations where id = p_invitation for update;
  if not found then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
  v_email := public.collab_user_email(p_actor);
  if v_email is null or v_email <> i.email then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
  if i.status = 'accepted' and i.accepted_by = p_actor and exists (select 1 from public.team_memberships where team_id = i.team_id and user_id = p_actor) then return jsonb_build_object('team_id', i.team_id, 'role', i.role, 'already', true); end if;
  if i.status <> 'pending' then raise exception 'invitation_closed' using errcode = 'P0001'; end if;
  if i.expires_at <= now() then raise exception 'invitation_expired' using errcode = 'P0001'; end if;
  if exists (select 1 from public.team_memberships where team_id = i.team_id and user_id = p_actor) then raise exception 'already_member' using errcode = '23505'; end if;
  insert into public.team_memberships (team_id, user_id, role, seat_type, added_by)
  values (i.team_id, p_actor, i.role, case when i.role = 'guest' then 'guest' else 'paid' end, i.invited_by);
  update public.team_invitations set status = 'accepted', responded_at = now(), accepted_by = p_actor where id = i.id;
  perform public.team_log(i.team_id, p_actor, 'team_member_joined', p_actor, jsonb_build_object('role', i.role));
  return jsonb_build_object('team_id', i.team_id, 'role', i.role, 'already', false);
end $$;

-- One accept path for emailed links: project invitations first, then team invitations.
create or replace function public.collab_accept(p_actor uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_hash text := public.collab_hash_token(p_token);
begin
  select id into v_id from public.project_invitations where token_hash = v_hash;
  if v_id is not null then return public.collab_accept_row(p_actor, v_id) || jsonb_build_object('kind', 'project'); end if;
  select id into v_id from public.team_invitations where token_hash = v_hash;
  if v_id is not null then return public.team_accept_row(p_actor, v_id) || jsonb_build_object('kind', 'team'); end if;
  raise exception 'invitation_invalid' using errcode = 'P0002';
end $$;

create or replace function public.collab_accept_by_id(p_actor uuid, p_invitation uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.project_invitations where id = p_invitation) then return public.collab_accept_row(p_actor, p_invitation) || jsonb_build_object('kind', 'project'); end if;
  if exists (select 1 from public.team_invitations where id = p_invitation) then return public.team_accept_row(p_actor, p_invitation) || jsonb_build_object('kind', 'team'); end if;
  raise exception 'invitation_invalid' using errcode = 'P0002';
end $$;

create or replace function public.collab_decline(p_actor uuid, p_invitation uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare p public.project_invitations%rowtype; t public.team_invitations%rowtype;
begin
  select * into p from public.project_invitations where id = p_invitation for update;
  if found then
    if public.collab_user_email(p_actor) is distinct from p.email then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
    if p.status <> 'pending' then raise exception 'invitation_closed' using errcode = 'P0001'; end if;
    update public.project_invitations set status = 'declined', responded_at = now() where id = p.id;
    perform public.collab_log(p.study_id, p_actor, 'invitation_declined', p_actor, jsonb_build_object('invitation', p.id));
    return;
  end if;
  select * into t from public.team_invitations where id = p_invitation for update;
  if not found or public.collab_user_email(p_actor) is distinct from t.email then raise exception 'invitation_invalid' using errcode = 'P0002'; end if;
  if t.status <> 'pending' then raise exception 'invitation_closed' using errcode = 'P0001'; end if;
  update public.team_invitations set status = 'declined', responded_at = now() where id = t.id;
end $$;

create or replace function public.collab_invitation_preview(p_actor uuid, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare i public.project_invitations%rowtype; t public.team_invitations%rowtype; v_title text; v_from text; v_hash text := public.collab_hash_token(p_token);
begin
  select * into i from public.project_invitations where token_hash = v_hash;
  if found then
    if public.collab_user_email(p_actor) is distinct from i.email then return jsonb_build_object('state', 'invalid'); end if;
    select title into v_title from public.studies where id = i.study_id;
    select full_name into v_from from public.profiles where id = i.invited_by;
    return jsonb_build_object('kind', 'project', 'state', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
      'invitation_id', i.id, 'study_title', v_title, 'role', i.role, 'title_label', i.title_label, 'invited_by', v_from, 'expires_at', i.expires_at);
  end if;
  select * into t from public.team_invitations where token_hash = v_hash;
  if found and public.collab_user_email(p_actor) is not distinct from t.email then
    select name into v_title from public.teams where id = t.team_id;
    select full_name into v_from from public.profiles where id = t.invited_by;
    return jsonb_build_object('kind', 'team', 'state', case when t.status = 'pending' and t.expires_at <= now() then 'expired' else t.status end,
      'invitation_id', t.id, 'study_title', v_title, 'role', t.role, 'invited_by', v_from, 'expires_at', t.expires_at);
  end if;
  return jsonb_build_object('state', 'invalid');
end $$;

create or replace function public.collab_my_invitations(p_actor uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
    select i.created_at, jsonb_build_object('kind', 'project', 'invitation_id', i.id, 'study_title', s.title, 'role', i.role, 'title_label', i.title_label, 'invited_by', p.full_name, 'expires_at', i.expires_at) as j
      from public.project_invitations i join public.studies s on s.id = i.study_id left join public.profiles p on p.id = i.invited_by
     where i.status = 'pending' and i.expires_at > now() and i.email = public.collab_user_email(p_actor)
    union all
    select t.created_at, jsonb_build_object('kind', 'team', 'invitation_id', t.id, 'study_title', tm.name, 'role', t.role, 'title_label', null, 'invited_by', p.full_name, 'expires_at', t.expires_at)
      from public.team_invitations t join public.teams tm on tm.id = t.team_id left join public.profiles p on p.id = t.invited_by
     where t.status = 'pending' and t.expires_at > now() and t.email = public.collab_user_email(p_actor)) x
$$;

create or replace function public.team_remove_member(p_actor uuid, p_team uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_actor text := public.team_role_of(p_team, p_actor); v_target text := public.team_role_of(p_team, p_user);
begin
  if v_target is null then raise exception 'not_a_member' using errcode = 'P0002'; end if;
  if v_target = 'owner' then raise exception 'owner_cannot_leave' using errcode = 'P0001'; end if;
  if p_actor <> p_user then
    if coalesce(v_actor, '') not in ('owner', 'administrator') or (v_actor = 'administrator' and v_target = 'administrator') then raise exception 'not_team_admin' using errcode = '42501'; end if;
  end if;
  -- Their team projects must be handed over first, so a departure never strands someone's work or hands it to them.
  if exists (select 1 from public.studies where team_id = p_team and owner_id = p_user) then raise exception 'owns_team_projects' using errcode = 'P0001'; end if;
  delete from public.team_memberships where team_id = p_team and user_id = p_user;
  perform public.team_log(p_team, p_actor, case when p_actor = p_user then 'team_member_left' else 'team_member_removed' end, p_user);
  perform public.collab_notify(p_user, 'team_removed', null, 'You were removed from a team', null, '/teams');
end $$;

create or replace function public.team_change_role(p_actor uuid, p_team uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_target text := public.team_role_of(p_team, p_user);
begin
  if public.team_role_of(p_team, p_actor) is distinct from 'owner' then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if v_target is null then raise exception 'not_a_member' using errcode = 'P0002'; end if;
  if v_target = 'owner' or p_role not in ('administrator', 'member', 'guest') then raise exception 'invalid_role' using errcode = '22023'; end if;
  update public.team_memberships set role = p_role, seat_type = case when p_role = 'guest' then 'guest' else 'paid' end where team_id = p_team and user_id = p_user;
  perform public.team_log(p_team, p_actor, 'team_role_changed', p_user, jsonb_build_object('role', p_role));
end $$;

-- A team project's owner (or the team owner) hands it to another paid member; the new owner gets full control, the old owner keeps no access.
create or replace function public.team_project_transfer(p_actor uuid, p_study uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.studies%rowtype;
begin
  select * into s from public.studies where id = p_study for update;
  if not found or s.team_id is null then raise exception 'not_team_project' using errcode = 'P0002'; end if;
  if p_actor <> s.owner_id and public.team_role_of(s.team_id, p_actor) is distinct from 'owner' then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.team_memberships where team_id = s.team_id and user_id = p_new_owner and seat_type = 'paid') then raise exception 'not_team_member' using errcode = '42501'; end if;
  delete from public.project_memberships where study_id = p_study and user_id = p_new_owner;
  update public.studies set owner_id = p_new_owner where id = p_study;
  perform public.collab_log(p_study, p_actor, 'project_transferred', p_new_owner);
  perform public.team_log(s.team_id, p_actor, 'project_transferred', p_new_owner, jsonb_build_object('study', p_study));
  perform public.collab_notify(p_new_owner, 'project_transferred', p_study, 'A team project was transferred to you: ' || s.title, null, '/studies/' || p_study || '/protocol');
end $$;

-- Add an existing team member to a team project. The project owner decides; team membership alone grants nothing.
create or replace function public.team_project_add_member(p_actor uuid, p_study uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.studies%rowtype; v_seat text;
begin
  select * into s from public.studies where id = p_study;
  if not found or s.team_id is null then raise exception 'not_team_project' using errcode = 'P0002'; end if;
  if public.study_role(p_study, p_actor) is distinct from 'owner' then raise exception 'not_owner' using errcode = '42501'; end if;
  if p_role not in ('editor', 'reviewer', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  select seat_type into v_seat from public.team_memberships where team_id = s.team_id and user_id = p_user;
  if v_seat is null then raise exception 'not_team_member' using errcode = '42501'; end if;
  if v_seat = 'guest' and p_role <> 'reviewer' then raise exception 'guest_reviewer_only' using errcode = '23514'; end if;
  insert into public.project_memberships (study_id, user_id, role, added_by) values (p_study, p_user, p_role, p_actor)
  on conflict (study_id, user_id) do update set role = excluded.role;
  perform public.collab_log(p_study, p_actor, 'member_added_from_team', p_user, jsonb_build_object('role', p_role));
  perform public.team_log(s.team_id, p_actor, 'project_member_added', p_user, jsonb_build_object('study', p_study, 'role', p_role));
  perform public.collab_notify(p_user, 'project_access', p_study, 'You were added to a project: ' || s.title, null, '/studies/' || p_study || '/protocol');
end $$;

-- Dashboard. Real counts only. Project content is never included; admins see titles, status and headcount.
create or replace function public.team_overview(p_actor uuid, p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text := public.team_role_of(p_team, p_actor); v_ent jsonb; v_use jsonb; v_paid_member boolean;
begin
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_paid_member := v_role in ('owner', 'administrator', 'member');
  v_ent := public.team_entitlements(p_team); v_use := public.team_seat_usage(p_team);
  return jsonb_build_object(
    'team', (select jsonb_build_object('id', t.id, 'name', t.name, 'created_at', t.created_at) from public.teams t where t.id = p_team),
    'your_role', v_role, 'entitlements', v_ent, 'seats', v_use,
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', p.full_name, 'institution', p.institution, 'role', m.role, 'seat_type', m.seat_type, 'joined_at', m.created_at,
        'projects', (select count(*) from public.studies s where s.team_id = p_team and s.owner_id = m.user_id)) order by (m.role = 'owner') desc, m.created_at)
        from public.team_memberships m join public.profiles p on p.id = m.user_id where m.team_id = p_team and (v_paid_member or m.user_id = p_actor or m.role in ('owner', 'administrator'))), '[]'::jsonb),
    'invitations', case when v_role in ('owner', 'administrator') then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'created_at', i.created_at, 'expires_at', i.expires_at,
        'delivery_status', i.delivery_status, 'delivery_error', i.delivery_error, 'expired', i.expires_at <= now()) order by i.created_at desc)
        from public.team_invitations i where i.team_id = p_team and i.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end,
    'stats', jsonb_build_object(
      'projects', (select count(*) from public.studies where team_id = p_team and (v_paid_member or public.study_role(id, p_actor) is not null)),
      'active_projects', (select count(*) from public.studies where team_id = p_team and status = 'active' and (v_paid_member or public.study_role(id, p_actor) is not null)),
      'documents', (select count(*) from public.team_documents where team_id = p_team and deleted_at is null and status = 'ready' and (v_paid_member or (study_id is not null and public.study_role(study_id, p_actor) is not null))),
      'storage_bytes', (select coalesce(sum(size_bytes), 0) from public.team_documents where team_id = p_team and deleted_at is null),
      'shared_references', (select count(*) from public.team_references where team_id = p_team),
      'submissions', (select count(*) from public.review_submissions rs join public.studies s on s.id = rs.study_id where s.team_id = p_team),
      'approvals', (select count(*) from public.review_approvals a join public.studies s on s.id = a.study_id where s.team_id = p_team)),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status, 'owner', o.full_name, 'owner_id', s.owner_id,
        'last_activity_at', s.last_activity_at, 'people', (select count(*) from public.project_memberships pm where pm.study_id = s.id) + 1,
        'your_role', public.study_role(s.id, p_actor)) order by s.last_activity_at desc)
        from public.studies s join public.profiles o on o.id = s.owner_id
       where s.team_id = p_team and (v_paid_member or public.study_role(s.id, p_actor) is not null)), '[]'::jsonb));
end $$;

create or replace function public.team_list(p_actor uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', m.role, 'seat_type', m.seat_type,
      'members', (select count(*) from public.team_memberships x where x.team_id = t.id),
      'projects', (select count(*) from public.studies s where s.team_id = t.id and (m.seat_type = 'paid' or public.study_role(s.id, p_actor) is not null))) order by t.created_at), '[]'::jsonb)
    from public.team_memberships m join public.teams t on t.id = m.team_id where m.user_id = p_actor and t.archived_at is null
$$;

create or replace function public.team_activity(p_actor uuid, p_team uuid, p_limit int default 40)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator', 'member') then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'action', e.action, 'actor', a.full_name, 'target', t.full_name, 'meta', e.meta, 'project', s.title) order by e.created_at desc)
    from (select * from public.collab_events x where x.team_id = p_team or x.study_id in (select id from public.studies where team_id = p_team) order by x.created_at desc limit least(greatest(p_limit, 1), 200)) e
    left join public.profiles a on a.id = e.actor_id left join public.profiles t on t.id = e.target_user left join public.studies s on s.id = e.study_id), '[]'::jsonb);
end $$;

-- Shared references: associations, with private notes, tags and collections left out. ----------------------------------------------------
create or replace function public.team_share_reference(p_actor uuid, p_team uuid, p_reference uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_study uuid;
begin
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator', 'member') then raise exception 'not_team_member' using errcode = '42501'; end if;
  select study_id into v_study from public.study_references where id = p_reference;
  if v_study is null or coalesce(public.study_role(v_study, p_actor), '') not in ('owner', 'editor') then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.team_references (team_id, reference_id, shared_by) values (p_team, p_reference, p_actor) on conflict do nothing;
  perform public.team_log(p_team, p_actor, 'reference_shared');
end $$;

create or replace function public.team_unshare_reference(p_actor uuid, p_team_reference uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.team_references%rowtype;
begin
  select * into r from public.team_references where id = p_team_reference;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_actor is distinct from r.shared_by and coalesce(public.team_role_of(r.team_id, p_actor), '') not in ('owner', 'administrator') then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.team_references where id = p_team_reference;
end $$;

create or replace function public.team_library(p_actor uuid, p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator', 'member') then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', tr.id, 'shared_by', p.full_name, 'shared_by_id', tr.shared_by, 'shared_at', tr.created_at, 'source_title', s.title,
      'title', r.title, 'authors', r.authors, 'journal', r.journal, 'year', r.year, 'doi', r.doi, 'pmid', r.pmid,
      'linked_projects', (select count(*) from public.study_reference_links l where l.team_reference_id = tr.id)) order by tr.created_at desc)
    from public.team_references tr join public.study_references r on r.id = tr.reference_id join public.studies s on s.id = r.study_id left join public.profiles p on p.id = tr.shared_by
   where tr.team_id = p_team), '[]'::jsonb);
end $$;

create or replace function public.study_link_reference(p_actor uuid, p_study uuid, p_team_reference uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.team_references%rowtype;
begin
  select * into r from public.team_references where id = p_team_reference;
  if not found or coalesce(public.team_role_of(r.team_id, p_actor), '') not in ('owner', 'administrator', 'member') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if coalesce(public.study_role(p_study, p_actor), '') not in ('owner', 'editor') then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.study_reference_links (study_id, team_reference_id, linked_by) values (p_study, p_team_reference, p_actor) on conflict do nothing;
end $$;

create or replace function public.study_unlink_reference(p_actor uuid, p_study uuid, p_team_reference uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.study_role(p_study, p_actor), '') not in ('owner', 'editor') then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.study_reference_links where study_id = p_study and team_reference_id = p_team_reference;
end $$;

-- Called by signed-in users (row level security applies through can_read_study): bibliographic fields of the references linked into a project.
create or replace function public.study_linked_references(p_study uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select case when not public.can_read_study(p_study) then '[]'::jsonb else coalesce((
    select jsonb_agg((to_jsonb(r) - 'notes' - 'tags' - 'collection_id' - 'study_id' - 'display_order') || jsonb_build_object('link_id', tr.id, 'study_id', p_study, 'display_order', 100000, 'tags', '[]'::jsonb, 'collection_id', null) order by r.year desc nulls last)
      from public.study_reference_links l join public.team_references tr on tr.id = l.team_reference_id join public.study_references r on r.id = tr.reference_id
     where l.study_id = p_study), '[]'::jsonb) end
$$;

-- Documents ----------------------------------------------------------------------------------------------------------------------------------
create or replace function public.team_doc_register(p_actor uuid, p_team uuid, p_name text, p_mime text, p_size bigint, p_study uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid := gen_random_uuid(); v_ent jsonb := public.team_entitlements(p_team); v_used bigint; v_name text := btrim(coalesce(p_name, '')); v_safe text; v_max bigint;
begin
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator', 'member') then raise exception 'not_team_member' using errcode = '42501'; end if;
  if p_study is not null and (coalesce(public.study_role(p_study, p_actor), '') not in ('owner', 'editor') or (select team_id from public.studies where id = p_study) is distinct from p_team) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_max := (public.billing_setting_num('team_documents_max_mb') * 1048576)::bigint;
  if length(v_name) < 1 or length(v_name) > 200 or p_size is null or p_size <= 0 or p_size > v_max then raise exception 'invalid_document' using errcode = '22023'; end if;
  if p_mime not in ('application/pdf', 'text/plain', 'text/csv', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then raise exception 'unsupported_type' using errcode = '22023'; end if;
  select coalesce(sum(size_bytes), 0) into v_used from public.team_documents where team_id = p_team and deleted_at is null;
  if v_used + p_size > (v_ent ->> 'max_storage_mb')::bigint * 1048576 then raise exception 'storage_full' using errcode = 'P0001'; end if;
  if (select count(*) from public.team_documents where uploaded_by = p_actor and created_at > now() - interval '1 hour') >= 60 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  v_safe := regexp_replace(v_name, '[^A-Za-z0-9._-]+', '_', 'g');
  insert into public.team_documents (id, team_id, study_id, name, mime, size_bytes, storage_path, uploaded_by)
  values (v_id, p_team, p_study, v_name, p_mime, p_size, p_team || '/' || v_id || '/' || left(v_safe, 120), p_actor);
  return jsonb_build_object('id', v_id, 'path', (select storage_path from public.team_documents where id = v_id));
end $$;

create or replace function public.team_doc_finalize(p_actor uuid, p_doc uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare d public.team_documents%rowtype; v_size bigint;
begin
  select * into d from public.team_documents where id = p_doc and uploaded_by = p_actor and status = 'pending' for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select coalesce((metadata ->> 'size')::bigint, -1) into v_size from storage.objects where bucket_id = 'team-documents' and name = d.storage_path;
  if v_size is null or v_size <= 0 then raise exception 'upload_missing' using errcode = 'P0001'; end if;
  update public.team_documents set status = 'ready', size_bytes = v_size where id = p_doc;
  perform public.team_log(d.team_id, p_actor, 'document_uploaded', null, jsonb_build_object('name', d.name));
end $$;

create or replace function public.team_doc_delete(p_actor uuid, p_doc uuid)
returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare d public.team_documents%rowtype;
begin
  select * into d from public.team_documents where id = p_doc and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_actor is distinct from d.uploaded_by and coalesce(public.team_role_of(d.team_id, p_actor), '') not in ('owner', 'administrator') then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.team_documents set deleted_at = now() where id = p_doc;
  perform public.team_log(d.team_id, p_actor, 'document_deleted', null, jsonb_build_object('name', d.name));
  return d.storage_path;
end $$;

create or replace function public.team_documents_list(p_actor uuid, p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text := public.team_role_of(p_team, p_actor);
begin
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'mime', d.mime, 'size_bytes', d.size_bytes, 'uploaded_by', p.full_name, 'uploaded_by_id', d.uploaded_by,
      'created_at', d.created_at, 'project', s.title, 'study_id', d.study_id) order by d.created_at desc)
    from public.team_documents d left join public.profiles p on p.id = d.uploaded_by left join public.studies s on s.id = d.study_id
   where d.team_id = p_team and d.deleted_at is null and d.status = 'ready'
     and (v_role in ('owner', 'administrator', 'member') or (d.study_id is not null and public.study_role(d.study_id, p_actor) is not null))), '[]'::jsonb);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'team\_%' or p.proname like 'collab\_%' or p.proname in ('study_link_reference', 'study_unlink_reference'))
       and p.proname not in ('team_role', 'team_is_paid_member', 'team_is_member', 'team_doc_can_read', 'team_doc_storage_can_read', 'team_doc_storage_can_insert')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
grant execute on function public.team_role(uuid, uuid), public.team_is_paid_member(uuid, uuid), public.team_is_member(uuid), public.team_doc_can_read(uuid, uuid), public.team_doc_storage_can_read(text), public.team_doc_storage_can_insert(text),
  public.shares_team_with(uuid), public.study_linked_references(uuid) to authenticated, service_role;
