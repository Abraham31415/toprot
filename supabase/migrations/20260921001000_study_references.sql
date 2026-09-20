-- Reference manager (V1.1 checkpoint 4). References are attached to the study (not a
-- protocol version) since a bibliography isn't versioned the way the protocol object is.
-- Metadata always comes from a verified bibliographic API (CrossRef for DOIs, PubMed/NCBI
-- E-utilities for PMIDs and title search) -- never generated or guessed -- so every field
-- below is nullable except title, in case a lookup returns a partial record.

create type reference_identifier_type as enum ('doi', 'pmid', 'manual');

create table study_references (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,

  identifier_type reference_identifier_type not null,
  doi text,
  pmid text,

  authors text[] not null default '{}',
  title text not null,
  journal text,
  year int,
  volume text,
  issue text,
  pages text,

  display_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table study_references enable row level security;

create policy "study_references_owner_all" on study_references for all
  using (is_study_owner(study_id)) with check (is_study_owner(study_id));

create policy "study_references_supervisor_select" on study_references for select
  using (is_study_supervisor(study_id));
