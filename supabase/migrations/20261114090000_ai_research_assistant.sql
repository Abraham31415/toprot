-- Phase 6: AI research assistant.
--
-- Additive. Depends on the AI credit system (20261109120000_ai_usage_credits.sql), which meters every call.
--
--  * ai_features      three assistant tiers (light / standard / deep). The router picks a tier per request; each tier
--                     carries its own model chain and hard limits (tokens, iterations, tool calls, cost, input size).
--  * ai_settings      extra assistant limits (document sizes, request frequency, history). Edited with SQL, no deploy.
--  * assistant_threads / assistant_messages   the user's conversations. Private to their owner.

-- 1. Tiers --------------------------------------------------------------------------------------------------------

insert into public.ai_features
  (feature_key, description, model_chain, max_output_tokens, max_input_chars, max_iterations, max_tool_calls, max_op_cost_micro_usd)
values
  ('assistant_light', 'Research assistant: simple, short tasks (brainstorming, refining a question)',
   array['claude-haiku-5-5', 'claude-sonnet-5-5'], 1500, 30000, 3, 4, 50000),
  ('assistant_standard', 'Research assistant: most tasks (review, summarising, evidence extraction, writing help)',
   array['claude-sonnet-5-5', 'claude-haiku-5-5'], 3000, 80000, 6, 10, 300000),
  ('assistant_deep', 'Research assistant: complex, multi-document work the user asked to be thorough',
   array['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], 4000, 120000, 8, 16, 750000)
on conflict (feature_key) do nothing;

-- 2. Limits -------------------------------------------------------------------------------------------------------
-- Read by the server with the service role. The server also clamps every value to a hard ceiling in code, so a typo
-- here can never remove a limit.

insert into public.ai_settings (key, value_num, description) values
  ('assistant_max_message_chars', 4000, 'Longest question a user may send to the assistant.'),
  ('assistant_max_context_chars', 24000, 'Characters of project context and conversation history sent with a request.'),
  ('assistant_max_tool_output_chars', 6000, 'Longest result a single tool call may return to the model.'),
  ('assistant_max_total_tool_output_chars', 30000, 'Total tool output the model may read in one request.'),
  ('assistant_max_document_chars', 40000, 'Most manuscript text the assistant may read in one request.'),
  ('assistant_max_documents', 8, 'Most PDFs a request may be scoped to.'),
  ('assistant_daily_requests_per_user', 40, 'Assistant requests one user may make per UTC day.'),
  ('assistant_history_messages', 6, 'Earlier messages of a thread included with a new request.'),
  ('assistant_max_threads', 50, 'Conversations one user may keep.'),
  ('assistant_max_messages_per_thread', 40, 'Messages one conversation may hold.'),
  ('assistant_deep_requires_pro', 0, '1 = only Pro subscribers may use the deep tier. 0 = anyone with enough credits.')
on conflict (key) do nothing;

-- 3. Conversations ------------------------------------------------------------------------------------------------

create table public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  study_id uuid references public.studies(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_threads_owner_idx on public.assistant_threads (owner_id, updated_at desc);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  task text,
  content jsonb not null,
  model text,
  tier text check (tier is null or tier in ('light', 'standard', 'deep')),
  charged_credits numeric,
  created_at timestamptz not null default now(),
  constraint assistant_messages_content_size check (pg_column_size(content) <= 200000)
);
create index assistant_messages_thread_idx on public.assistant_messages (thread_id, created_at);
create index assistant_messages_owner_day_idx on public.assistant_messages (owner_id, created_at desc) where role = 'assistant';

alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;

-- Owners read and delete their own conversations. Writes of messages come from the server (service role), which is
-- what guarantees every stored answer went through the metered, verified path.
create policy "assistant_threads_owner_select" on public.assistant_threads for select using (owner_id = auth.uid());
create policy "assistant_threads_owner_delete" on public.assistant_threads for delete using (owner_id = auth.uid());
create policy "assistant_messages_owner_select" on public.assistant_messages for select using (owner_id = auth.uid());
