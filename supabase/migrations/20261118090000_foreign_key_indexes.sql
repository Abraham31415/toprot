-- Indexes for foreign-key columns that queries, security policies or cascading deletes actually use.
--
-- A foreign key without an index makes every delete of the parent row scan the child table, and makes lookups by that column slow
-- as the table grows. A production check found 29 such columns. Most are "who last edited this" references to user accounts that
-- are read rarely; they are left alone, because every extra index costs a little on every write. These are the ones that matter.
--
-- Safe to run more than once. It only adds indexes and changes no data.

-- Study-scoped lists and cascades when a study is deleted.
create index if not exists amendments_study_idx on public.amendments (study_id);
create index if not exists deviation_reports_study_idx on public.deviation_reports (study_id);
create index if not exists deviation_reports_version_idx on public.deviation_reports (protocol_version_id);
create index if not exists deviations_version_idx on public.deviations (protocol_version_id);
create index if not exists assistant_threads_study_idx on public.assistant_threads (study_id) where study_id is not null;

-- Billing and credits: refunds, allocation release and payment history look rows up by these.
create index if not exists ai_credit_transactions_lot_idx on public.ai_credit_transactions (lot_id) where lot_id is not null;
create index if not exists ai_credit_transactions_payment_idx on public.ai_credit_transactions (payment_id) where payment_id is not null;
create index if not exists ai_credit_transactions_event_idx on public.ai_credit_transactions (event_id) where event_id is not null;
create index if not exists ai_credit_allocations_lot_idx on public.ai_credit_allocations (lot_id);
create index if not exists payment_events_payment_idx on public.payment_events (payment_id);
create index if not exists ai_subscription_events_user_idx on public.ai_subscription_events (user_id);

-- Row-level security on annotations checks the owner on every read.
create index if not exists pdf_annotations_owner_idx on public.pdf_annotations (owner_id);
