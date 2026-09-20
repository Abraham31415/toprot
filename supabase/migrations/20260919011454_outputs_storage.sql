-- Private storage bucket for generated protocol outputs (data dictionary,
-- Stata skeleton, etc). Objects are stored at "<study_id>/<version_id>/<file>",
-- so RLS can authorize by reading the study_id out of the path.

insert into storage.buckets (id, name, public)
values ('protocol-outputs', 'protocol-outputs', false)
on conflict (id) do nothing;

create policy "protocol_outputs_owner_all" on storage.objects for all
  using (
    bucket_id = 'protocol-outputs'
    and (storage.foldername(name))[1]::uuid in (select id from studies where owner_id = auth.uid())
  )
  with check (
    bucket_id = 'protocol-outputs'
    and (storage.foldername(name))[1]::uuid in (select id from studies where owner_id = auth.uid())
  );

create policy "protocol_outputs_supervisor_select" on storage.objects for select
  using (
    bucket_id = 'protocol-outputs'
    and (storage.foldername(name))[1]::uuid in (
      select study_id from study_supervisors where supervisor_id = auth.uid()
    )
  );
