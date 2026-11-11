-- Phase 5: academic writing (manuscripts, version history) and the PDF research library.
--
-- Purely additive. Nothing here touches existing tables except adding two AI feature rows.
--
--  * manuscripts           one per document, always inside a study. Content is TipTap/ProseMirror JSON.
--  * manuscript_versions   snapshots. Written by save_manuscript / restore_manuscript_version only.
--  * pdf_documents         the user's private PDF library (metadata only; files live in Storage).
--  * pdf_chunks            extracted text split into passages with the PDF page number they came from.
--  * pdf_annotations       the user's own notes and highlighted passages, tied to a page.

-- 1. Manuscripts -------------------------------------------------------------------------

create table public.manuscripts (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  created_by uuid default auth.uid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  template text not null default 'blank' check (template in (
    'blank', 'research_proposal', 'original_article', 'systematic_review',
    'case_report', 'thesis', 'dissertation', 'conference_abstract')),
  content jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  style_id text not null default 'apa' check (style_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(style_id) <= 120),
  word_count int not null default 0 check (word_count >= 0),
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manuscripts_content_size check (pg_column_size(content) <= 3000000)
);
create index manuscripts_study_idx on public.manuscripts (study_id, updated_at desc);

create table public.manuscript_versions (
  id uuid primary key default gen_random_uuid(),
  manuscript_id uuid not null references public.manuscripts(id) on delete cascade,
  revision int not null,
  title text not null,
  content jsonb not null,
  word_count int not null default 0,
  kind text not null check (kind in ('auto', 'manual', 'restore')),
  label text check (label is null or length(label) <= 120),
  created_at timestamptz not null default now(),
  constraint manuscript_versions_content_size check (pg_column_size(content) <= 3000000)
);
create index manuscript_versions_idx on public.manuscript_versions (manuscript_id, created_at desc);

alter table public.manuscripts enable row level security;
alter table public.manuscript_versions enable row level security;

create policy "manuscripts_owner_all" on public.manuscripts for all
  using (public.is_study_owner(study_id)) with check (public.is_study_owner(study_id));
create policy "manuscripts_supervisor_select" on public.manuscripts for select
  using (public.is_study_supervisor(study_id));

create or replace function public.manuscript_study(p_manuscript_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select study_id from public.manuscripts where id = p_manuscript_id;
$$;

-- Versions are only ever created by the two functions below (which run as the caller, so RLS still applies).
create policy "manuscript_versions_owner_select" on public.manuscript_versions for select
  using (public.is_study_owner(public.manuscript_study(manuscript_id)));
create policy "manuscript_versions_supervisor_select" on public.manuscript_versions for select
  using (public.is_study_supervisor(public.manuscript_study(manuscript_id)));
create policy "manuscript_versions_owner_insert" on public.manuscript_versions for insert
  with check (public.is_study_owner(public.manuscript_study(manuscript_id)));
-- Only automatic snapshots can be pruned. Manual and restore points are permanent.
create policy "manuscript_versions_owner_delete_auto" on public.manuscript_versions for delete
  using (kind = 'auto' and public.is_study_owner(public.manuscript_study(manuscript_id)));

-- Saves content if (and only if) the caller still holds the latest revision, so two tabs can never
-- silently overwrite each other. Takes an automatic snapshot at most every 10 minutes.
create or replace function public.save_manuscript(
  p_id uuid, p_base_revision int, p_title text, p_content jsonb, p_word_count int,
  p_snapshot boolean default false, p_label text default null
) returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_rev int;
  v_title text;
  v_study uuid;
  v_last timestamptz;
begin
  update public.manuscripts
     set title = coalesce(nullif(btrim(p_title), ''), title),
         content = p_content,
         word_count = greatest(coalesce(p_word_count, 0), 0),
         revision = revision + 1,
         updated_at = now()
   where id = p_id and revision = p_base_revision
  returning revision, title into v_rev, v_title;

  if v_rev is null then
    select study_id into v_study from public.manuscripts where id = p_id;
    if v_study is null then raise exception 'manuscript_not_found' using errcode = 'P0002'; end if;
    if not public.is_study_owner(v_study) then raise exception 'manuscript_forbidden' using errcode = '42501'; end if;
    raise exception 'revision_conflict' using errcode = 'P0001';
  end if;

  select max(created_at) into v_last from public.manuscript_versions where manuscript_id = p_id and kind = 'auto';
  if p_snapshot or v_last is null or v_last < now() - interval '10 minutes' then
    insert into public.manuscript_versions (manuscript_id, revision, title, content, word_count, kind, label)
    values (p_id, v_rev, v_title, p_content, greatest(coalesce(p_word_count, 0), 0),
            case when p_snapshot then 'manual' else 'auto' end,
            case when p_snapshot then left(p_label, 120) else null end);
    delete from public.manuscript_versions
     where manuscript_id = p_id and kind = 'auto'
       and id not in (select id from public.manuscript_versions where manuscript_id = p_id and kind = 'auto' order by created_at desc limit 40);
  end if;
  return v_rev;
end;
$$;

-- Restores an old version. The current text is kept as a 'restore' point first, so a restore can itself be undone.
create or replace function public.restore_manuscript_version(p_version_id uuid, p_base_revision int)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v public.manuscript_versions%rowtype;
  m public.manuscripts%rowtype;
  v_rev int;
begin
  select * into v from public.manuscript_versions where id = p_version_id;
  if not found then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  select * into m from public.manuscripts where id = v.manuscript_id and revision = p_base_revision for update;
  if not found then
    if not public.is_study_owner(public.manuscript_study(v.manuscript_id)) then raise exception 'manuscript_forbidden' using errcode = '42501'; end if;
    raise exception 'revision_conflict' using errcode = 'P0001';
  end if;
  insert into public.manuscript_versions (manuscript_id, revision, title, content, word_count, kind, label)
  values (m.id, m.revision, m.title, m.content, m.word_count, 'restore', 'Before restore');
  update public.manuscripts
     set title = v.title, content = v.content, word_count = v.word_count, revision = revision + 1, updated_at = now()
   where id = m.id
  returning revision into v_rev;
  return jsonb_build_object('revision', v_rev, 'title', v.title, 'content', v.content, 'word_count', v.word_count);
end;
$$;

grant execute on function public.save_manuscript(uuid, int, text, jsonb, int, boolean, text) to authenticated;
grant execute on function public.restore_manuscript_version(uuid, int) to authenticated;
revoke execute on function public.save_manuscript(uuid, int, text, jsonb, int, boolean, text) from anon, public;
revoke execute on function public.restore_manuscript_version(uuid, int) from anon, public;

-- 2. PDF library -------------------------------------------------------------------------

create table public.pdf_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  study_id uuid references public.studies(id) on delete set null,
  reference_id uuid references public.study_references(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 300),
  original_filename text not null check (length(original_filename) <= 255),
  storage_path text not null unique,
  file_size bigint not null check (file_size > 0 and file_size <= 20971520),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  page_count int check (page_count is null or page_count >= 0),
  char_count int not null default 0,
  -- ready = text extracted; no_text = a scan or image-only PDF (no OCR is performed); failed = could not be read.
  status text not null check (status in ('ready', 'no_text', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  doi text check (doi is null or length(doi) <= 200),
  folder text check (folder is null or length(btrim(folder)) between 1 and 80),
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  notes text check (notes is null or length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pdf_documents_metadata_size check (pg_column_size(metadata) <= 20000)
);
create unique index pdf_documents_owner_hash_idx on public.pdf_documents (owner_id, sha256) where sha256 is not null;
create index pdf_documents_owner_idx on public.pdf_documents (owner_id, created_at desc);
create index pdf_documents_study_idx on public.pdf_documents (study_id) where study_id is not null;
create index pdf_documents_reference_idx on public.pdf_documents (reference_id) where reference_id is not null;

-- Library limits: 100 files and 100 MB per user. The per-file limit (20 MB) is the check above and the bucket's own limit.
create or replace function public.pdf_documents_enforce_limits() returns trigger
language plpgsql security invoker set search_path = public as $$
declare used bigint; n int;
begin
  select coalesce(sum(file_size), 0), count(*) into used, n from public.pdf_documents where owner_id = new.owner_id;
  if n >= 100 then raise exception 'pdf_library_full' using errcode = 'P0001'; end if;
  if used + new.file_size > 104857600 then raise exception 'pdf_quota_exceeded' using errcode = 'P0001'; end if;
  return new;
end;
$$;
create trigger pdf_documents_limits before insert on public.pdf_documents
  for each row execute function public.pdf_documents_enforce_limits();

-- A linked study or reference must belong to the person linking it.
create or replace function public.pdf_documents_check_links() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  -- Only links being set or changed are checked, so a cascade that clears a link never fails.
  if new.study_id is not null and (tg_op = 'INSERT' or new.study_id is distinct from old.study_id)
     and not public.is_study_owner(new.study_id) then
    raise exception 'pdf_link_forbidden' using errcode = '42501';
  end if;
  if new.reference_id is not null and (tg_op = 'INSERT' or new.reference_id is distinct from old.reference_id) and not exists (
    select 1 from public.study_references r where r.id = new.reference_id and public.is_study_owner(r.study_id)
  ) then
    raise exception 'pdf_link_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger pdf_documents_links before insert or update of study_id, reference_id on public.pdf_documents
  for each row execute function public.pdf_documents_check_links();

create table public.pdf_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.pdf_documents(id) on delete cascade,
  page int not null check (page >= 1),
  idx int not null check (idx >= 0),
  text text not null check (length(text) between 1 and 6000),
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  unique (document_id, page, idx)
);
create index pdf_chunks_tsv_idx on public.pdf_chunks using gin (tsv);

create table public.pdf_annotations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.pdf_documents(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page int not null check (page >= 1),
  quote text check (quote is null or length(quote) <= 2000),
  note text check (note is null or length(note) <= 5000),
  color text not null default 'yellow' check (color in ('yellow', 'green', 'blue', 'pink')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (quote is not null or note is not null)
);
create index pdf_annotations_doc_idx on public.pdf_annotations (document_id, page);

alter table public.pdf_documents enable row level security;
alter table public.pdf_chunks enable row level security;
alter table public.pdf_annotations enable row level security;

-- The library is private to its owner. Supervisors do not see uploaded PDFs (they are often copyrighted).
create policy "pdf_documents_owner_all" on public.pdf_documents for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.owns_pdf(p_document_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pdf_documents where id = p_document_id and owner_id = auth.uid());
$$;

create policy "pdf_chunks_owner_all" on public.pdf_chunks for all
  using (public.owns_pdf(document_id)) with check (public.owns_pdf(document_id));
create policy "pdf_annotations_owner_all" on public.pdf_annotations for all
  using (owner_id = auth.uid() and public.owns_pdf(document_id))
  with check (owner_id = auth.uid() and public.owns_pdf(document_id));

-- Full-text search over the caller's own PDFs (RLS applies, so it can never see anyone else's).
-- Words are OR-ed so a natural-language question still finds passages; ranking favours passages matching more of them.
create or replace function public.search_pdf_chunks(p_query text, p_document_ids uuid[] default null, p_limit int default 20)
returns table (chunk_id bigint, document_id uuid, page int, idx int, text text, headline text, rank real)
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
declare q tsquery;
begin
  if p_query is null or btrim(p_query) = '' then return; end if;
  q := nullif(replace(plainto_tsquery('english', left(p_query, 1000))::text, ' & ', ' | '), '')::tsquery;
  if q is null then return; end if;
  return query
    select c.id, c.document_id, c.page, c.idx, c.text,
           ts_headline('english', c.text, q, 'StartSel=[[, StopSel=]], MaxFragments=1, MaxWords=35, MinWords=12'),
           ts_rank_cd(c.tsv, q)
      from public.pdf_chunks c
     where c.tsv @@ q
       and (p_document_ids is null or c.document_id = any (p_document_ids))
     order by ts_rank_cd(c.tsv, q) desc, c.document_id, c.page, c.idx
     limit least(greatest(coalesce(p_limit, 20), 1), 60);
end;
$$;
grant execute on function public.search_pdf_chunks(text, uuid[], int) to authenticated;
revoke execute on function public.search_pdf_chunks(text, uuid[], int) from anon, public;

-- 3. AI features -------------------------------------------------------------------------
-- Document questions and paper comparison are metered like every other AI feature.

insert into public.ai_features
  (feature_key, description, model_chain, max_output_tokens, max_input_chars, max_iterations, max_tool_calls, max_op_cost_micro_usd)
values
  ('pdf_qa', 'Grounded questions about the user''s uploaded PDFs',
   array['claude-sonnet-5-5', 'claude-haiku-5-5'], 3000, 60000, 1, 0, 150000),
  ('pdf_compare', 'Side-by-side comparison of uploaded PDFs, every cell tied to a quoted passage',
   array['claude-sonnet-5-5', 'claude-haiku-5-5'], 4000, 90000, 1, 0, 250000)
on conflict (feature_key) do nothing;
