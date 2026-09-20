-- Auto-create profile (and workspace, for supervisors) on signup, plus RLS policies
-- for every table from the initial schema migration.

-- 1. Auto-provisioning trigger ------------------------------------------------
-- Runs as the function owner (bypasses RLS), so it works regardless of whether
-- the client has an active session yet (e.g. email confirmation pending).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, institution)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'student'),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'institution'
  );

  if coalesce(new.raw_user_meta_data->>'role', 'student') = 'supervisor' then
    insert into public.workspaces (supervisor_id, name)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'My') || '''s workspace');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. RLS helper functions ------------------------------------------------------
-- security definer so they can read studies/study_supervisors without
-- recursing back through the RLS policies that call them.

create or replace function public.is_study_owner(p_study_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from studies s where s.id = p_study_id and s.owner_id = auth.uid()
  );
$$;

create or replace function public.is_study_supervisor(p_study_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from study_supervisors ss
    where ss.study_id = p_study_id and ss.supervisor_id = auth.uid()
  );
$$;

create or replace function public.study_id_for_protocol_version(p_version_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select study_id from protocol_versions where id = p_version_id;
$$;

-- 3. profiles --------------------------------------------------------------

create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_update_own" on profiles for update using (id = auth.uid());

create policy "profiles_select_as_supervisor" on profiles for select using (
  exists (
    select 1 from study_supervisors ss join studies s on s.id = ss.study_id
    where ss.supervisor_id = auth.uid() and s.owner_id = profiles.id
  )
);

create policy "profiles_select_as_student" on profiles for select using (
  exists (
    select 1 from study_supervisors ss join studies s on s.id = ss.study_id
    where s.owner_id = auth.uid() and ss.supervisor_id = profiles.id
  )
);

-- 4. workspaces --------------------------------------------------------------

create policy "workspaces_select_own" on workspaces for select using (supervisor_id = auth.uid());
create policy "workspaces_update_own" on workspaces for update using (supervisor_id = auth.uid());

-- 5. studies -------------------------------------------------------------------

create policy "studies_owner_all" on studies for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "studies_supervisor_select" on studies for select
  using (is_study_supervisor(id));

-- 6. protocol_versions -----------------------------------------------------------

create policy "protocol_versions_owner_all" on protocol_versions for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "protocol_versions_supervisor_select" on protocol_versions for select
  using (is_study_supervisor(study_id));

-- 7. protocol_objectives / protocol_variables --------------------------------------

create policy "protocol_objectives_owner_all" on protocol_objectives for all
  using (is_study_owner(study_id_for_protocol_version(protocol_version_id)))
  with check (is_study_owner(study_id_for_protocol_version(protocol_version_id)));

create policy "protocol_objectives_supervisor_select" on protocol_objectives for select
  using (is_study_supervisor(study_id_for_protocol_version(protocol_version_id)));

create policy "protocol_variables_owner_all" on protocol_variables for all
  using (is_study_owner(study_id_for_protocol_version(protocol_version_id)))
  with check (is_study_owner(study_id_for_protocol_version(protocol_version_id)));

create policy "protocol_variables_supervisor_select" on protocol_variables for select
  using (is_study_supervisor(study_id_for_protocol_version(protocol_version_id)));

-- 8. amendments ------------------------------------------------------------------

create policy "amendments_owner_all" on amendments for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "amendments_supervisor_select" on amendments for select
  using (is_study_supervisor(study_id));

create policy "amendments_supervisor_review" on amendments for update
  using (is_study_supervisor(study_id)) with check (is_study_supervisor(study_id));

-- 9. milestones / deviations ------------------------------------------------------

create policy "milestones_owner_all" on milestones for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "milestones_supervisor_select" on milestones for select
  using (is_study_supervisor(study_id));

create policy "deviations_owner_all" on deviations for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "deviations_supervisor_select" on deviations for select
  using (is_study_supervisor(study_id));

-- 10. generated_outputs / deviation_reports ----------------------------------------

create policy "generated_outputs_owner_all" on generated_outputs for all
  using (is_study_owner(study_id_for_protocol_version(protocol_version_id)))
  with check (is_study_owner(study_id_for_protocol_version(protocol_version_id)));

create policy "generated_outputs_supervisor_select" on generated_outputs for select
  using (is_study_supervisor(study_id_for_protocol_version(protocol_version_id)));

create policy "deviation_reports_owner_all" on deviation_reports for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "deviation_reports_supervisor_select" on deviation_reports for select
  using (is_study_supervisor(study_id));

-- 11. supervisor_invitations / study_supervisors -----------------------------------

create policy "supervisor_invitations_student_all" on supervisor_invitations for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "supervisor_invitations_invitee_select" on supervisor_invitations for select
  using (lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "supervisor_invitations_invitee_respond" on supervisor_invitations for update
  using (lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create policy "study_supervisors_owner_all" on study_supervisors for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "study_supervisors_supervisor_select" on study_supervisors for select
  using (supervisor_id = auth.uid());

create policy "study_supervisors_supervisor_insert_on_accept" on study_supervisors for insert
  with check (
    supervisor_id = auth.uid()
    and exists (
      select 1 from supervisor_invitations si
      where si.id = invitation_id
        and si.study_id = study_supervisors.study_id
        and si.status = 'accepted'
        and lower(si.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
