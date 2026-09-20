-- A supervisor needs to see the study's title on their pending invitation,
-- before they've accepted (i.e. before is_study_supervisor() would be true).

create policy "studies_select_via_pending_invitation" on studies for select
  using (
    exists (
      select 1 from supervisor_invitations si
      where si.study_id = studies.id
        and si.status = 'pending'
        and lower(si.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
