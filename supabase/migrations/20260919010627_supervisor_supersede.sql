-- When a supervisor approves-and-locks an amendment draft, the study's
-- previously registered version must flip to 'superseded'. Only the study
-- owner had update rights on a 'registered' row before this; the
-- protocol_versions_immutable trigger already guarantees this policy can
-- only ever be used for the pure status transition (registered -> superseded),
-- nothing else, so it's safe to extend to the attached supervisor too.
create policy "protocol_versions_supervisor_supersede" on protocol_versions for update
  using (is_study_supervisor(study_id) and status = 'registered')
  with check (is_study_supervisor(study_id));
