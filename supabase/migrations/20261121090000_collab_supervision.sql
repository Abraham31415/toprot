-- Collaboration, stage 2: academic supervision.
--
-- An INTERNAL ToProt workflow between a researcher and the supervisors (reviewer role) they invited. It records who reviewed which
-- submitted version and what they decided. It is NOT ethics committee approval, institutional approval or journal peer review, and
-- the interface says so wherever an approval appears.
--
-- Workflow, tracked separately for every supervisor so each has an independent history:
--   (no submission = Draft) > submitted > under_review > changes_requested > resubmitted > approved
-- Approval is a human act: it needs a signed-in reviewer and an explicit confirmation, runs only through collab_approve, and is stored
-- as an immutable, versioned row pinned to a snapshot of exactly what was submitted. Nothing in the AI code paths can call it.
--
-- Reuses: project roles and study_role from stage 1, collab_events for the activity trail, manuscript_versions for manuscript text.

-- 1. Submissions (immutable snapshots of what the supervisors were asked to review) ------------------------------------------------

create table public.review_submissions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  submission_number int not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  note text check (note is null or length(note) <= 2000),
  -- What was submitted: the protocol (fields, objectives, variables) and the manuscript revisions, with a hash over all of it.
  snapshot jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (study_id, submission_number)
);
create index review_submissions_study_idx on public.review_submissions (study_id, submission_number desc);

-- 2. Per supervisor state, history and approvals ------------------------------------------------------------------------------------

create table public.review_states (
  study_id uuid not null references public.studies (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('submitted', 'under_review', 'changes_requested', 'resubmitted', 'approved')),
  submission_id uuid not null references public.review_submissions (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (study_id, reviewer_id)
);
create index review_states_reviewer_idx on public.review_states (reviewer_id, status);

create table public.review_history (
  id bigint generated always as identity primary key,
  study_id uuid not null references public.studies (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  submission_id uuid references public.review_submissions (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (note is null or length(note) <= 4000),
  created_at timestamptz not null default now()
);
create index review_history_idx on public.review_history (study_id, reviewer_id, created_at);

create table public.review_approvals (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  submission_id uuid not null references public.review_submissions (id) on delete cascade,
  approval_number int not null,
  content_hash text not null,
  statement text check (statement is null or length(statement) <= 2000),
  approved_at timestamptz not null default now(),
  unique (study_id, reviewer_id, approval_number)
);

create or replace function public.review_approvals_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.studies where id = old.study_id) then return old; end if; -- the whole project is being deleted
  raise exception 'approvals_are_immutable' using errcode = '42501';
end $$;
create trigger review_approvals_no_change before update or delete on public.review_approvals
  for each row execute function public.review_approvals_immutable();

-- 3. Comments: threads attached to a section --------------------------------------------------------------------------------------------

create table public.review_threads (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies (id) on delete cascade,
  submission_id uuid references public.review_submissions (id) on delete set null,
  -- 'general', 'protocol:<field>' or 'manuscript:<uuid>'. Section level only: the manuscript editor has no reliable anchor API.
  section text not null check (section ~ '^(general|protocol:[a-z_]{1,60}|manuscript:[0-9a-f-]{36})$'),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz
);
create index review_threads_study_idx on public.review_threads (study_id, status, created_at desc);

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.review_threads (id) on delete cascade,
  study_id uuid not null references public.studies (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index review_comments_thread_idx on public.review_comments (thread_id, created_at);

-- 4. In-app notifications (work with no realtime and no email) ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (length(kind) <= 60),
  study_id uuid references public.studies (id) on delete cascade,
  title text not null check (length(title) <= 200),
  body text check (body is null or length(body) <= 500),
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.#%-]*$'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- 5. Row level security: members read; only the server writes (except marking your own notifications read) -----------------------------------

alter table public.review_submissions enable row level security;
alter table public.review_states enable row level security;
alter table public.review_history enable row level security;
alter table public.review_approvals enable row level security;
alter table public.review_threads enable row level security;
alter table public.review_comments enable row level security;
alter table public.notifications enable row level security;
revoke all on table public.review_submissions, public.review_states, public.review_history, public.review_approvals, public.review_threads,
  public.review_comments, public.notifications from public, anon, authenticated;

grant select on public.review_submissions, public.review_states, public.review_history, public.review_approvals, public.review_threads, public.review_comments to authenticated;
create policy review_submissions_read on public.review_submissions for select to authenticated using (public.can_read_study(study_id));
create policy review_states_read on public.review_states for select to authenticated using (public.can_read_study(study_id));
create policy review_history_read on public.review_history for select to authenticated using (public.can_read_study(study_id));
create policy review_approvals_read on public.review_approvals for select to authenticated using (public.can_read_study(study_id));
create policy review_threads_read on public.review_threads for select to authenticated using (public.can_read_study(study_id));
create policy review_comments_read on public.review_comments for select to authenticated using (public.can_read_study(study_id));

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_mark on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 6. Functions ------------------------------------------------------------------------------------------------------------------------------

create or replace function public.collab_notify(p_user uuid, p_kind text, p_study uuid, p_title text, p_body text default null, p_link text default null)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.notifications (user_id, kind, study_id, title, body, link) values (p_user, p_kind, p_study, left(p_title, 200), left(p_body, 500), p_link) $$;

-- Notify everyone on a project except one account (usually the person who did the thing).
create or replace function public.collab_notify_project(p_study uuid, p_except uuid, p_kind text, p_title text, p_body text default null, p_link text default null, p_roles text[] default array['owner', 'editor', 'reviewer', 'viewer'])
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record;
begin
  for r in
    select s.owner_id as uid, 'owner'::text as role from public.studies s where s.id = p_study
    union all select m.user_id, m.role from public.project_memberships m where m.study_id = p_study
  loop
    if r.uid is distinct from p_except and r.role = any (p_roles) and public.study_role(p_study, r.uid) is not null then
      perform public.collab_notify(r.uid, p_kind, p_study, p_title, p_body, p_link);
    end if;
  end loop;
end $$;

create or replace function public.collab_review_snapshot(p_study uuid, p_number int, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v public.protocol_versions%rowtype; v_ms jsonb := '[]'::jsonb; m record; v_ver uuid;
begin
  select * into v from public.protocol_versions where study_id = p_study and status in ('draft', 'registered') order by version_number desc limit 1;
  for m in select id, title, revision, content, word_count from public.manuscripts where study_id = p_study order by created_at loop
    -- Keep the exact text: a manual manuscript version is never pruned.
    insert into public.manuscript_versions (manuscript_id, revision, title, content, word_count, kind, label)
    values (m.id, m.revision, m.title, m.content, m.word_count, 'manual', left('Submitted for review #' || p_number, 120))
    returning id into v_ver;
    v_ms := v_ms || jsonb_build_array(jsonb_build_object('id', m.id, 'title', m.title, 'revision', m.revision, 'word_count', m.word_count, 'version_id', v_ver,
      'content_sha256', encode(sha256(convert_to(m.content::text, 'utf8')), 'hex')));
  end loop;
  return jsonb_build_object(
    'protocol', coalesce(to_jsonb(v), '{}'::jsonb),
    'objectives', coalesce((select jsonb_agg(to_jsonb(o) order by o.display_order) from public.protocol_objectives o where o.protocol_version_id = v.id), '[]'::jsonb),
    'variables', coalesce((select jsonb_agg(to_jsonb(x) order by x.display_order) from public.protocol_variables x where x.protocol_version_id = v.id), '[]'::jsonb),
    'manuscripts', v_ms);
end $$;

create or replace function public.collab_review_set(p_study uuid, p_reviewer uuid, p_to text, p_submission uuid, p_actor uuid, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_from text;
begin
  select status into v_from from public.review_states where study_id = p_study and reviewer_id = p_reviewer;
  insert into public.review_states (study_id, reviewer_id, status, submission_id) values (p_study, p_reviewer, p_to, p_submission)
  on conflict (study_id, reviewer_id) do update set status = excluded.status, submission_id = excluded.submission_id, updated_at = now();
  insert into public.review_history (study_id, reviewer_id, submission_id, from_status, to_status, actor_id, note)
  values (p_study, p_reviewer, p_submission, v_from, p_to, p_actor, p_note);
end $$;

-- Owner or editor sends the current project to every active supervisor.
create or replace function public.collab_review_submit(p_actor uuid, p_study uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_role text := public.study_role(p_study, p_actor); v_n int; v_sub uuid; v_snap jsonb; r record; v_to text; v_count int := 0;
begin
  if coalesce(v_role, '') not in ('owner', 'editor') then raise exception 'not_allowed' using errcode = '42501'; end if;
  perform 1 from public.studies where id = p_study for update; -- serialise submissions for this project
  if exists (select 1 from public.review_states where study_id = p_study and status = 'under_review') then raise exception 'review_in_progress' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.project_memberships m where m.study_id = p_study and m.role = 'reviewer' and public.study_role(p_study, m.user_id) = 'reviewer') then
    raise exception 'no_reviewers' using errcode = 'P0001'; end if;
  select coalesce(max(submission_number), 0) + 1 into v_n from public.review_submissions where study_id = p_study;
  v_snap := public.collab_review_snapshot(p_study, v_n, p_actor);
  insert into public.review_submissions (study_id, submission_number, submitted_by, note, snapshot, content_hash)
  values (p_study, v_n, p_actor, nullif(btrim(p_note), ''), v_snap, encode(sha256(convert_to(v_snap::text, 'utf8')), 'hex'))
  returning id into v_sub;
  for r in select m.user_id from public.project_memberships m where m.study_id = p_study and m.role = 'reviewer' and public.study_role(p_study, m.user_id) = 'reviewer' loop
    v_to := case when (select status from public.review_states where study_id = p_study and reviewer_id = r.user_id) = 'changes_requested' then 'resubmitted' else 'submitted' end;
    perform public.collab_review_set(p_study, r.user_id, v_to, v_sub, p_actor, nullif(btrim(p_note), ''));
    perform public.collab_notify(r.user_id, 'review_requested', p_study,
      (case when v_to = 'resubmitted' then 'Resubmitted for your review: ' else 'Review requested: ' end) || (select title from public.studies where id = p_study),
      nullif(btrim(p_note), ''), '/studies/' || p_study || '/review');
    v_count := v_count + 1;
  end loop;
  perform public.collab_log(p_study, p_actor, 'review_submitted', null, jsonb_build_object('submission', v_n, 'reviewers', v_count));
  return jsonb_build_object('submission_id', v_sub, 'submission_number', v_n, 'reviewers', v_count);
end $$;

create or replace function public.collab_review_transition(p_actor uuid, p_study uuid, p_to text, p_note text, p_statement text default null, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare st public.review_states%rowtype; v_latest uuid; v_hash text; v_num int; v_title text; v_label text;
begin
  if public.study_role(p_study, p_actor) is distinct from 'reviewer' then raise exception 'not_reviewer' using errcode = '42501'; end if;
  select * into st from public.review_states where study_id = p_study and reviewer_id = p_actor for update;
  if not found then raise exception 'nothing_to_review' using errcode = 'P0001'; end if;
  select id, content_hash into v_latest, v_hash from public.review_submissions where study_id = p_study order by submission_number desc limit 1;
  select title into v_title from public.studies where id = p_study;

  if p_to = 'under_review' then
    if st.status not in ('submitted', 'resubmitted') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    perform public.collab_review_set(p_study, p_actor, 'under_review', st.submission_id, p_actor, null);
    perform public.collab_notify_project(p_study, p_actor, 'review_started', 'A supervisor started reviewing: ' || v_title, null, '/studies/' || p_study || '/review', array['owner']);
  elsif p_to = 'changes_requested' then
    if st.status <> 'under_review' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    if p_note is null or length(btrim(p_note)) < 3 then raise exception 'note_required' using errcode = '22023'; end if;
    perform public.collab_review_set(p_study, p_actor, 'changes_requested', st.submission_id, p_actor, p_note);
    perform public.collab_notify_project(p_study, p_actor, 'changes_requested', 'Changes requested: ' || v_title, left(p_note, 300), '/studies/' || p_study || '/review', array['owner', 'editor']);
  elsif p_to = 'approved' then
    if st.status <> 'under_review' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    if p_confirm is not true then raise exception 'confirmation_required' using errcode = '22023'; end if;
    if st.submission_id <> v_latest then raise exception 'submission_superseded' using errcode = 'P0001'; end if;
    select coalesce(max(approval_number), 0) + 1 into v_num from public.review_approvals where study_id = p_study and reviewer_id = p_actor;
    insert into public.review_approvals (study_id, reviewer_id, submission_id, approval_number, content_hash, statement)
    values (p_study, p_actor, st.submission_id, v_num, v_hash, nullif(btrim(p_statement), ''));
    perform public.collab_review_set(p_study, p_actor, 'approved', st.submission_id, p_actor, nullif(btrim(p_statement), ''));
    perform public.collab_notify_project(p_study, p_actor, 'review_approved', 'Approved by a supervisor: ' || v_title, 'Internal ToProt review approval. This is not ethics or institutional approval.', '/studies/' || p_study || '/review', array['owner', 'editor']);
    perform public.collab_log(p_study, p_actor, 'review_approved', p_actor, jsonb_build_object('approval_number', v_num));
    return jsonb_build_object('status', 'approved', 'approval_number', v_num);
  else
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  perform public.collab_log(p_study, p_actor, 'review_' || p_to, p_actor, '{}'::jsonb);
  return jsonb_build_object('status', p_to);
end $$;

-- Comments -----------------------------------------------------------------------------------------------------------------------------------

create or replace function public.collab_comment_add(p_actor uuid, p_study uuid, p_section text, p_body text, p_thread uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_role text := public.study_role(p_study, p_actor); v_thread uuid := p_thread; v_sub uuid; v_title text; v_body text := btrim(coalesce(p_body, ''));
begin
  if coalesce(v_role, '') not in ('owner', 'editor', 'reviewer') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if length(v_body) < 1 or length(v_body) > 4000 then raise exception 'invalid_comment' using errcode = '22023'; end if;
  if (select count(*) from public.review_comments where author_id = p_actor and created_at > now() - interval '1 minute') >= 20 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  select title into v_title from public.studies where id = p_study;
  if v_thread is null then
    if p_section !~ '^(general|protocol:[a-z_]{1,60}|manuscript:[0-9a-f-]{36})$' then raise exception 'invalid_section' using errcode = '22023'; end if;
    select id into v_sub from public.review_submissions where study_id = p_study order by submission_number desc limit 1;
    insert into public.review_threads (study_id, submission_id, section, created_by) values (p_study, v_sub, p_section, p_actor) returning id into v_thread;
  else
    if not exists (select 1 from public.review_threads where id = v_thread and study_id = p_study) then raise exception 'thread_not_found' using errcode = 'P0002'; end if;
    update public.review_threads set status = 'open', resolved_by = null, resolved_at = null where id = v_thread and status = 'resolved';
  end if;
  insert into public.review_comments (thread_id, study_id, author_id, body) values (v_thread, p_study, p_actor, v_body);
  perform public.collab_notify_project(p_study, p_actor, 'comment', 'New comment on ' || v_title, left(v_body, 200), '/studies/' || p_study || '/review', array['owner', 'editor', 'reviewer']);
  return jsonb_build_object('thread_id', v_thread);
end $$;

create or replace function public.collab_thread_resolve(p_actor uuid, p_study uuid, p_thread uuid, p_resolved boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare t public.review_threads%rowtype; v_role text := public.study_role(p_study, p_actor);
begin
  select * into t from public.review_threads where id = p_thread and study_id = p_study;
  if not found then raise exception 'thread_not_found' using errcode = 'P0002'; end if;
  if coalesce(v_role, '') not in ('owner', 'editor', 'reviewer') then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.review_threads set status = case when p_resolved then 'resolved' else 'open' end,
         resolved_by = case when p_resolved then p_actor end, resolved_at = case when p_resolved then now() end where id = p_thread;
end $$;

-- The review page for a project: submissions, every supervisor's status and history, immutable approvals, threads and comments.
create or replace function public.collab_review_overview(p_actor uuid, p_study uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text := public.study_role(p_study, p_actor); v_latest uuid; v_latest_n int;
begin
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select id, submission_number into v_latest, v_latest_n from public.review_submissions where study_id = p_study order by submission_number desc limit 1;
  return jsonb_build_object(
    'your_role', v_role,
    'latest_submission', (select jsonb_build_object('id', s.id, 'number', s.submission_number, 'note', s.note, 'created_at', s.created_at,
        'submitted_by', p.full_name, 'content_hash', s.content_hash,
        'manuscripts', coalesce(s.snapshot -> 'manuscripts', '[]'::jsonb)) from public.review_submissions s left join public.profiles p on p.id = s.submitted_by where s.id = v_latest),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.submission_number, 'created_at', s.created_at, 'note', s.note, 'submitted_by', p.full_name) order by s.submission_number desc)
        from public.review_submissions s left join public.profiles p on p.id = s.submitted_by where s.study_id = p_study), '[]'::jsonb),
    'reviewers', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'full_name', p.full_name, 'title_label', m.title_label,
        'status', coalesce(rs.status, 'draft'), 'on_latest', rs.submission_id = v_latest, 'updated_at', rs.updated_at,
        'history', coalesce((select jsonb_agg(jsonb_build_object('from', h.from_status, 'to', h.to_status, 'note', h.note, 'at', h.created_at, 'submission', sub.submission_number) order by h.created_at)
            from public.review_history h left join public.review_submissions sub on sub.id = h.submission_id where h.study_id = p_study and h.reviewer_id = m.user_id), '[]'::jsonb),
        'approvals', coalesce((select jsonb_agg(jsonb_build_object('number', a.approval_number, 'at', a.approved_at, 'statement', a.statement, 'submission', sub.submission_number,
              'content_hash', a.content_hash, 'current', a.submission_id = v_latest) order by a.approval_number desc)
            from public.review_approvals a join public.review_submissions sub on sub.id = a.submission_id where a.study_id = p_study and a.reviewer_id = m.user_id), '[]'::jsonb)
      ) order by m.created_at)
      from public.project_memberships m join public.profiles p on p.id = m.user_id left join public.review_states rs on rs.study_id = m.study_id and rs.reviewer_id = m.user_id
      where m.study_id = p_study and m.role = 'reviewer' and public.study_role(p_study, m.user_id) = 'reviewer'), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'section', t.section, 'status', t.status, 'created_at', t.created_at, 'submission', sub.submission_number,
        'resolved_at', t.resolved_at,
        'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'author', a.full_name, 'author_id', c.author_id, 'body', c.body, 'at', c.created_at) order by c.created_at)
            from public.review_comments c left join public.profiles a on a.id = c.author_id where c.thread_id = t.id), '[]'::jsonb)) order by t.created_at desc)
        from public.review_threads t left join public.review_submissions sub on sub.id = t.submission_id where t.study_id = p_study), '[]'::jsonb));
end $$;

-- The Supervision workspace: every project the account reviews, with their status on it.
create or replace function public.collab_supervision_overview(p_actor uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'study_id', s.id, 'title', s.title, 'owner_name', o.full_name, 'study_status', s.status, 'last_activity_at', s.last_activity_at,
      'review_status', coalesce(rs.status, 'draft'), 'status_at', rs.updated_at,
      'latest_submission_at', (select max(created_at) from public.review_submissions x where x.study_id = s.id),
      'on_latest', rs.submission_id = (select id from public.review_submissions x where x.study_id = s.id order by submission_number desc limit 1),
      'open_threads', (select count(*) from public.review_threads t where t.study_id = s.id and t.status = 'open'),
      'approvals', (select count(*) from public.review_approvals a where a.study_id = s.id and a.reviewer_id = p_actor)
    ) order by (rs.status in ('submitted', 'resubmitted')) desc nulls last, s.last_activity_at desc), '[]'::jsonb)
    from public.project_memberships m join public.studies s on s.id = m.study_id join public.profiles o on o.id = s.owner_id
    left join public.review_states rs on rs.study_id = s.id and rs.reviewer_id = m.user_id
   where m.user_id = p_actor and m.role = 'reviewer' and public.study_role(s.id, p_actor) = 'reviewer'
$$;

-- Notifications -----------------------------------------------------------------------------------------------------------------------------------

create or replace function public.collab_notifications(p_actor uuid, p_limit int default 50, p_unread_only boolean default false)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
    from (select id, kind, study_id, title, body, link, created_at, read_at from public.notifications
           where user_id = p_actor and (not p_unread_only or read_at is null) order by created_at desc limit least(greatest(p_limit, 1), 200)) n
$$;

create or replace function public.collab_unread_count(p_actor uuid)
returns int language sql stable security definer set search_path = public, pg_temp
as $$ select count(*)::int from public.notifications where user_id = p_actor and read_at is null $$;

create or replace function public.collab_mark_read(p_actor uuid, p_ids uuid[] default null)
returns int language sql security definer set search_path = public, pg_temp
as $$ with u as (update public.notifications set read_at = now() where user_id = p_actor and read_at is null and (p_ids is null or id = any (p_ids)) returning 1) select count(*)::int from u $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'collab\_%' or p.proname = 'review_approvals_immutable')
       and p.proname not in ('collab_project_plan', 'collab_role_limit')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
