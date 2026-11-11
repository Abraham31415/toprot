-- Private Storage bucket for the PDF research library.
-- Objects live at "<user id>/<document id>.pdf", so a policy can authorize by the first path segment.
-- Limits: 20 MB per file (the bucket enforces it before anything is stored), PDFs only, and 100 MB per user.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('research-pdfs', 'research-pdfs', false, 20971520, array['application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

-- security definer: a policy on storage.objects cannot query storage.objects directly without recursing.
create or replace function public.research_pdf_bytes_used(p_user uuid)
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum(coalesce((metadata ->> 'size')::bigint, 0)), 0)
    from storage.objects
   where bucket_id = 'research-pdfs' and (storage.foldername(name))[1] = p_user::text;
$$;

create policy "research_pdfs_owner_select" on storage.objects for select
  using (bucket_id = 'research-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "research_pdfs_owner_insert" on storage.objects for insert
  with check (
    bucket_id = 'research-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.research_pdf_bytes_used(auth.uid()) < 104857600
  );

create policy "research_pdfs_owner_delete" on storage.objects for delete
  using (bucket_id = 'research-pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
