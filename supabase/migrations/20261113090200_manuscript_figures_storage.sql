-- Private Storage bucket for manuscript figures.
-- Objects live at "<user id>/<manuscript id>/<image id>.<ext>". The owner folder authorises writes;
-- a supervisor attached to the manuscript's study can read, so a read-only view still shows figures.
-- Limits: 5 MB per image, PNG / JPEG / GIF only (Word export cannot embed other formats), 50 MB per user.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuscript-figures', 'manuscript-figures', false, 5242880, array['image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

-- Returns the manuscript id from a figure path, or null if the second path segment is not a uuid
-- (so a malformed object name can never make a policy raise a cast error).
create or replace function public.figure_manuscript(p_name text)
returns uuid language sql immutable as $$
  select case when (string_to_array(p_name, '/'))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then ((string_to_array(p_name, '/'))[2])::uuid end;
$$;

create or replace function public.figure_bytes_used(p_user uuid)
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum(coalesce((metadata ->> 'size')::bigint, 0)), 0)
    from storage.objects
   where bucket_id = 'manuscript-figures' and (storage.foldername(name))[1] = p_user::text;
$$;

create policy "manuscript_figures_owner_select" on storage.objects for select
  using (bucket_id = 'manuscript-figures' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "manuscript_figures_supervisor_select" on storage.objects for select
  using (
    bucket_id = 'manuscript-figures'
    and public.figure_manuscript(name) is not null
    and public.is_study_supervisor(public.manuscript_study(public.figure_manuscript(name)))
  );

-- The folder must be the user's own AND the manuscript must be one they own, so nobody can park files under another manuscript id.
create policy "manuscript_figures_owner_insert" on storage.objects for insert
  with check (
    bucket_id = 'manuscript-figures'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.figure_manuscript(name) is not null
    and public.is_study_owner(public.manuscript_study(public.figure_manuscript(name)))
    and public.figure_bytes_used(auth.uid()) < 52428800
  );

create policy "manuscript_figures_owner_delete" on storage.objects for delete
  using (bucket_id = 'manuscript-figures' and (storage.foldername(name))[1] = auth.uid()::text);
