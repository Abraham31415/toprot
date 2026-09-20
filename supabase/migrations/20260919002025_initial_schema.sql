-- ToProt initial schema: protocol object and related tables.
-- RLS policies are added in a later migration alongside auth/roles work.

create type user_role as enum ('student', 'supervisor');
create type study_status as enum ('active', 'completed');
create type protocol_status as enum ('draft', 'registered', 'superseded');
create type registration_method as enum ('self', 'supervisor_approved');
create type variable_type as enum ('continuous', 'categorical', 'binary', 'ordinal', 'date', 'text');
create type variable_role as enum ('exposure', 'outcome', 'covariate', 'identifier', 'other');
create type objective_type as enum ('primary', 'secondary');
create type deviation_category as enum ('eligibility', 'intervention', 'data_collection', 'consent', 'sample_size', 'timeline', 'analysis', 'other');
create type output_type as enum ('data_dictionary', 'kobo_form', 'redcap_form', 'stata_skeleton', 'table_shells', 'methods_paragraph', 'ethics_package', 'consent_form');
create type amendment_status as enum ('proposed', 'approved', 'rejected', 'applied');
create type invitation_status as enum ('pending', 'accepted', 'declined', 'revoked');

-- 1. Identity -----------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  institution text,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null unique references profiles(id) on delete cascade,
  name text not null,
  stalled_threshold_days int not null default 14,
  created_at timestamptz not null default now()
);

-- 2. Studies --------------------------------------------------------------

create table studies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  status study_status not null default 'active',
  current_enrollment int not null default 0,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Protocol object -------------------------------------------------------

create table protocol_versions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  version_number int not null,

  status protocol_status not null default 'draft',
  registration_method registration_method,
  registered_at timestamptz,
  registered_by uuid references profiles(id),
  approval_requested_at timestamptz,
  approved_by uuid references profiles(id),

  -- Section 1: study identity
  study_title text,
  short_title text,
  study_design text,
  site text,
  principal_investigator_name text,
  anticipated_start_date date,
  anticipated_end_date date,

  -- Section 2: research question
  research_question text,

  -- Section 3: population and eligibility
  target_population text,
  setting text,
  inclusion_criteria jsonb not null default '[]',
  exclusion_criteria jsonb not null default '[]',

  -- Section 5: statistical plan
  statistical_methods text,
  primary_analysis text,
  significance_level numeric default 0.05,
  analysis_software text default 'Stata',

  -- Section 6: sample size
  sample_size_method text,
  sample_size_inputs jsonb,
  calculated_sample_size int,
  stress_test_results jsonb,

  -- Section 7: data collection
  data_collection_methods text,
  data_sources text,
  data_management_plan text,

  -- Section 8: ethical considerations
  ethical_approval_body text,
  consent_process text,
  risks_and_benefits text,
  confidentiality_plan text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (study_id, version_number)
);

-- at most one draft and one registered version per study
create unique index one_draft_per_study on protocol_versions (study_id) where status = 'draft';
create unique index one_registered_per_study on protocol_versions (study_id) where status = 'registered';

create table protocol_objectives (
  id uuid primary key default gen_random_uuid(),
  protocol_version_id uuid not null references protocol_versions(id) on delete cascade,
  objective_type objective_type not null,
  description text not null,
  display_order int not null default 0
);

create table protocol_variables (
  id uuid primary key default gen_random_uuid(),
  protocol_version_id uuid not null references protocol_versions(id) on delete cascade,
  variable_name text not null,
  variable_slug text not null,
  variable_type variable_type not null,
  role variable_role not null default 'other',
  unit text,
  value_labels jsonb,
  measurement_timepoint text,
  description text,
  display_order int not null default 0,
  unique (protocol_version_id, variable_slug)
);

create table amendments (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  previous_version_id uuid not null references protocol_versions(id),
  new_version_id uuid references protocol_versions(id),
  reason text not null,
  status amendment_status not null default 'proposed',
  proposed_by uuid not null references profiles(id),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 4. Tracking during the study ---------------------------------------------

create table milestones (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  milestone_type text not null check (milestone_type in (
    'protocol_written', 'ethics_submitted', 'ethics_approved',
    'enrollment_started', 'enrollment_completed', 'data_collection_complete',
    'analysis_complete', 'manuscript_drafted', 'submitted_for_publication',
    'defended', 'published'
  )),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'complete')),
  target_date date,
  completed_at timestamptz,
  notes text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (study_id, milestone_type)
);

create table deviations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  protocol_version_id uuid not null references protocol_versions(id),
  category deviation_category not null,
  description text not null,
  occurred_at date not null,
  impact_assessment text,
  reported_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- 5. Generated artifacts -----------------------------------------------------

create table generated_outputs (
  id uuid primary key default gen_random_uuid(),
  protocol_version_id uuid not null references protocol_versions(id) on delete cascade,
  output_type output_type not null,
  file_path text not null,
  file_format text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references profiles(id)
);

create table deviation_reports (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  protocol_version_id uuid not null references protocol_versions(id),
  final_analysis_file_path text not null,
  comparison_result jsonb not null,
  export_docx_path text,
  export_pdf_path text,
  generated_at timestamptz not null default now(),
  generated_by uuid not null references profiles(id)
);

-- 6. Supervisor layer ---------------------------------------------------------

create table supervisor_invitations (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references profiles(id),
  status invitation_status not null default 'pending',
  token text not null unique,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create table study_supervisors (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  supervisor_id uuid not null references profiles(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invitation_id uuid references supervisor_invitations(id),
  attached_at timestamptz not null default now(),
  unique (study_id, supervisor_id)
);

-- 7. Indexes for common lookups -----------------------------------------------

create index studies_owner_id_idx on studies(owner_id);
create index protocol_versions_study_id_idx on protocol_versions(study_id);
create index protocol_objectives_version_id_idx on protocol_objectives(protocol_version_id);
create index protocol_variables_version_id_idx on protocol_variables(protocol_version_id);
create index milestones_study_id_idx on milestones(study_id);
create index deviations_study_id_idx on deviations(study_id);
create index generated_outputs_version_id_idx on generated_outputs(protocol_version_id);
create index study_supervisors_supervisor_id_idx on study_supervisors(supervisor_id);
create index supervisor_invitations_study_id_idx on supervisor_invitations(study_id);
