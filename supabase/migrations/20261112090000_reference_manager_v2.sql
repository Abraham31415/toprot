-- Reference manager v2: richer metadata, tags, notes, collections and provenance.
--
-- Purely additive. Existing rows keep working: every new column is nullable or has a default.
-- Metadata still comes only from a bibliographic source (CrossRef, PubMed, OpenAlex), a file the user
-- imported, or the user's own typing. `source` records which, so a reference's origin is never ambiguous.

alter table public.study_references
  add column if not exists work_type text,
  add column if not exists abstract text,
  add column if not exists url text,
  add column if not exists publisher text,
  add column if not exists issn text,
  add column if not exists language text,
  add column if not exists notes text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists keywords text[] not null default '{}',
  add column if not exists source text,
  add column if not exists openalex_id text,
  add column if not exists is_open_access boolean,
  add column if not exists open_access_url text,
  add column if not exists author_details jsonb,
  add column if not exists collection_id uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.study_references
  add constraint study_references_source_check check (source is null or source in ('manual', 'crossref', 'pubmed', 'openalex', 'import', 'zotero')),
  add constraint study_references_abstract_size check (abstract is null or length(abstract) <= 20000),
  add constraint study_references_notes_size check (notes is null or length(notes) <= 5000),
  add constraint study_references_tags_size check (cardinality(tags) <= 30),
  add constraint study_references_keywords_size check (cardinality(keywords) <= 50),
  add constraint study_references_author_details_size check (author_details is null or pg_column_size(author_details) <= 60000);

create table public.reference_collections (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.studies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (study_id, name)
);

alter table public.study_references
  add constraint study_references_collection_fk foreign key (collection_id) references public.reference_collections(id) on delete set null;

create index study_references_collection_idx on public.study_references (collection_id);
create index study_references_study_doi_idx on public.study_references (study_id, lower(doi)) where doi is not null;
create index reference_collections_study_idx on public.reference_collections (study_id);

alter table public.reference_collections enable row level security;

create policy "reference_collections_owner_all" on public.reference_collections for all
  using (public.is_study_owner(study_id))
  with check (public.is_study_owner(study_id));

create policy "reference_collections_supervisor_select" on public.reference_collections for select
  using (public.is_study_supervisor(study_id));
