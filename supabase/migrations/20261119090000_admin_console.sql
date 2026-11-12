-- Admin console: access control, tamper-evident audit log, account suspension, controlled credit grants, first-party product events,
-- job and alert records, and the aggregate reporting functions behind /admin.
--
-- Design:
--   * Reuses what exists: app_admins / is_app_admin, payments and payment_events, ai_credit_lots / ai_credit_transactions,
--     ai_usage_events, ai_subscriptions, ai_platform_days, ai_budget_alerts, ai_get_headroom. No financial or credit table is duplicated.
--   * Everything here is callable only by the service role, which exists only on the server. Every function takes the acting admin's
--     id and checks it against app_admins itself (admin_assert), so a leaked or mis-wired caller still cannot read or write.
--   * Reports are aggregates computed in SQL. Nothing is estimated silently: where a figure needs a setting that is not set (for
--     example infrastructure cost) the function returns null, and the interface says "not available" instead of showing zero.

-- 1. Administrators -----------------------------------------------------------------------------------------------------

alter table public.app_admins
  add column if not exists role text not null default 'admin' check (role in ('owner', 'admin', 'viewer')),
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists note text;

-- Nobody can become an administrator through the API: app_admins has row level security on, no policy and no privileges for
-- anon or authenticated (see the billing migration). Rows are added only with SQL by the project owner.
revoke all on table public.app_admins from public, anon, authenticated;

create or replace function public.admin_assert(p_actor uuid, p_write boolean default false)
returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare r text;
begin
  select role into r from public.app_admins where user_id = p_actor;
  if r is null then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_write and r = 'viewer' then raise exception 'read_only_admin' using errcode = '42501'; end if;
  return r;
end $$;

-- 2. Settings for the console ---------------------------------------------------------------------------------------------

insert into public.billing_settings (key, value_num, description) values
  ('admin_grant_max_credits', 500, 'Largest promotional credit grant one admin action may issue, in credits.'),
  ('admin_grant_daily_max_credits', 2000, 'Most promotional credits one administrator may issue in 24 hours.'),
  ('admin_sensitive_ops_per_hour', 30, 'Most account and credit changes one administrator may make per hour.')
on conflict (key) do nothing;

insert into public.ai_settings (key, value_num, description) values
  ('platform_monthly_budget_micro_usd', 150000000, 'Hard platform-wide AI spend ceiling per UTC calendar month, in micro-USD (150000000 = $150). 0 turns the monthly ceiling off.')
on conflict (key) do nothing;

-- 3. Audit log: append-only and hash-chained -----------------------------------------------------------------------------

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  ip text,
  prev_hash text not null,
  row_hash text not null
);
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id, action, created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id, created_at desc);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);

create or replace function public.admin_audit_hash(p_prev text, p_id bigint, p_at timestamptz, p_actor uuid, p_action text,
                                                   p_ttype text, p_tid text, p_reason text, p_details jsonb)
returns text language sql immutable
as $$ select encode(sha256(convert_to(
  p_prev || '|' || p_id::text || '|' || to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || coalesce(p_actor::text, '') || '|' ||
  p_action || '|' || coalesce(p_ttype, '') || '|' || coalesce(p_tid, '') || '|' || coalesce(p_reason, '') || '|' || p_details::text, 'UTF8')), 'hex') $$;

-- One insert at a time, so the chain is a single line. The statement-level lock is taken before any id is assigned.
create or replace function public.admin_audit_lock() returns trigger language plpgsql as
$$ begin perform pg_advisory_xact_lock(7270011); return null; end $$;
create trigger admin_audit_lock_trg before insert on public.admin_audit_log for each statement execute function public.admin_audit_lock();

create or replace function public.admin_audit_chain() returns trigger language plpgsql as $$
declare v_prev text;
begin
  select row_hash into v_prev from public.admin_audit_log order by id desc limit 1;
  new.prev_hash := coalesce(v_prev, repeat('0', 64));
  new.row_hash := public.admin_audit_hash(new.prev_hash, new.id, new.created_at, new.actor_id, new.action, new.target_type, new.target_id, new.reason, new.details);
  return new;
end $$;
create trigger admin_audit_chain_trg before insert on public.admin_audit_log for each row execute function public.admin_audit_chain();

create or replace function public.admin_audit_immutable() returns trigger language plpgsql as
$$ begin raise exception 'admin_audit_log is append-only' using errcode = '42501'; end $$;
create trigger admin_audit_no_change before update or delete on public.admin_audit_log for each row execute function public.admin_audit_immutable();
create trigger admin_audit_no_truncate before truncate on public.admin_audit_log for each statement execute function public.admin_audit_immutable();

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from public, anon, authenticated, service_role;

-- Writes one entry. Reads of private account pages are logged too (p_write false).
create or replace function public.admin_audit_write(p_actor uuid, p_action text, p_target_type text default null, p_target_id text default null,
                                                    p_reason text default null, p_details jsonb default '{}'::jsonb, p_ip text default null)
returns bigint
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id bigint; v_email text;
begin
  perform public.admin_assert(p_actor);
  select email into v_email from auth.users where id = p_actor;
  insert into public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, reason, details, ip)
  values (p_actor, v_email, left(p_action, 80), left(p_target_type, 40), left(p_target_id, 120), left(p_reason, 500), coalesce(p_details, '{}'::jsonb), left(p_ip, 64))
  returning id into v_id;
  return v_id;
end $$;

-- Raises when the administrator has already made p_max changes of this kind within the window.
create or replace function public.admin_rate_check(p_actor uuid, p_prefix text, p_max int, p_window interval default interval '1 hour')
returns void
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.admin_audit_log where actor_id = p_actor and action like p_prefix || '%' and created_at > now() - p_window) >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
end $$;

-- Recomputes the chain. Returns the id of the first entry that does not match, or null when the whole log is intact.
create or replace function public.admin_audit_verify(p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare r record; v_prev text := repeat('0', 64); v_n bigint := 0;
begin
  perform public.admin_assert(p_actor);
  for r in select * from public.admin_audit_log order by id loop
    if r.prev_hash <> v_prev or r.row_hash <> public.admin_audit_hash(r.prev_hash, r.id, r.created_at, r.actor_id, r.action, r.target_type, r.target_id, r.reason, r.details) then
      return jsonb_build_object('intact', false, 'first_bad_id', r.id, 'checked', v_n);
    end if;
    v_prev := r.row_hash; v_n := v_n + 1;
  end loop;
  return jsonb_build_object('intact', true, 'first_bad_id', null, 'checked', v_n);
end $$;

create or replace function public.admin_audit_page(p_actor uuid, p_action text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_rows jsonb; v_total bigint;
begin
  perform public.admin_assert(p_actor);
  select count(*) into v_total from public.admin_audit_log where p_action is null or action like p_action || '%';
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_rows from (
    select id, created_at, actor_email, action, target_type, target_id, reason, details, ip, left(row_hash, 12) as hash
      from public.admin_audit_log where p_action is null or action like p_action || '%'
     order by id desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) r;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- 4. Account suspension -------------------------------------------------------------------------------------------------

create table public.account_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended_at timestamptz not null default now(),
  reason text not null check (length(reason) >= 10),
  suspended_by uuid references auth.users (id) on delete set null
);
alter table public.account_suspensions enable row level security;
revoke all on table public.account_suspensions from public, anon, authenticated;
-- A signed-in person can see whether their own account is suspended (the site uses this to show a clear message). Nothing else.
grant select on public.account_suspensions to authenticated;
create policy account_suspensions_own on public.account_suspensions for select to authenticated using (user_id = auth.uid());

create or replace function public.admin_set_suspension(p_actor uuid, p_user uuid, p_suspend boolean, p_reason text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown_user' using errcode = 'P0001'; end if;
  if p_suspend and (p_user = p_actor or exists (select 1 from public.app_admins where user_id = p_user)) then
    raise exception 'cannot_suspend_admin' using errcode = 'P0001';
  end if;
  perform public.admin_rate_check(p_actor, 'account.', public.billing_setting_num('admin_sensitive_ops_per_hour')::int);
  if p_suspend then
    insert into public.account_suspensions (user_id, reason, suspended_by) values (p_user, trim(p_reason), p_actor)
    on conflict (user_id) do update set reason = excluded.reason, suspended_by = excluded.suspended_by, suspended_at = now();
  else
    delete from public.account_suspensions where user_id = p_user;
  end if;
  perform public.admin_audit_write(p_actor, case when p_suspend then 'account.suspend' else 'account.restore' end, 'user', p_user::text, trim(p_reason), '{}'::jsonb, p_ip);
  return jsonb_build_object('ok', true, 'suspended', p_suspend);
end $$;

-- 5. Controlled promotional credits -----------------------------------------------------------------------------------------
-- A grant is a credit lot like a purchase, but with source 'grant', its own expiry and a transaction of kind 'adjustment'. It adds
-- to what the person can spend; it never edits a payment, a subscription allowance or an existing lot.

create or replace function public.admin_grant_credits(p_actor uuid, p_user uuid, p_credits int, p_days int, p_reason text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_lot uuid; v_day numeric; v_max numeric := public.billing_setting_num('admin_grant_max_credits');
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if p_credits is null or p_credits < 1 or p_credits > v_max then raise exception 'credits_out_of_range' using errcode = 'P0001', detail = v_max::text; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'expiry_out_of_range' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown_user' using errcode = 'P0001'; end if;
  perform public.admin_rate_check(p_actor, 'credits.', public.billing_setting_num('admin_sensitive_ops_per_hour')::int);
  select coalesce(sum((details ->> 'credits')::numeric), 0) into v_day from public.admin_audit_log
   where actor_id = p_actor and action = 'credits.grant' and created_at > now() - interval '24 hours';
  if v_day + p_credits > public.billing_setting_num('admin_grant_daily_max_credits') then raise exception 'daily_limit_reached' using errcode = 'P0001'; end if;

  insert into public.ai_credit_lots (user_id, source, credits_mcr, expires_at, note)
  values (p_user, 'grant', p_credits::bigint * 1000, now() + make_interval(days => p_days), 'Admin grant: ' || left(trim(p_reason), 150))
  returning id into v_lot;
  insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, lot_id, note)
  values (p_user, 'adjustment', 'purchased', p_credits::bigint * 1000, v_lot, 'Admin grant: ' || left(trim(p_reason), 150));
  perform public.admin_audit_write(p_actor, 'credits.grant', 'user', p_user::text, trim(p_reason),
                                   jsonb_build_object('credits', p_credits, 'expires_in_days', p_days, 'lot_id', v_lot), p_ip);
  return jsonb_build_object('ok', true, 'lot_id', v_lot);
end $$;

-- Takes back the unused part of an admin grant (for example one issued by mistake).
create or replace function public.admin_revoke_grant(p_actor uuid, p_lot uuid, p_reason text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare l public.ai_credit_lots%rowtype; v_left bigint;
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  select * into l from public.ai_credit_lots where id = p_lot for update;
  if not found or l.source <> 'grant' then raise exception 'not_a_grant' using errcode = 'P0001'; end if;
  if l.expired_at is not null then raise exception 'already_expired' using errcode = 'P0001'; end if;
  if l.reserved_mcr > 0 then raise exception 'credits_in_use' using errcode = 'P0001'; end if;
  perform public.admin_rate_check(p_actor, 'credits.', public.billing_setting_num('admin_sensitive_ops_per_hour')::int);
  v_left := l.credits_mcr - l.used_mcr;
  if v_left > 0 then
    insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, lot_id, note)
    values (l.user_id, 'adjustment', 'purchased', -v_left, l.id, 'Admin grant revoked: ' || left(trim(p_reason), 150));
  end if;
  update public.ai_credit_lots set expired_at = now(), used_mcr = credits_mcr where id = l.id;
  perform public.admin_audit_write(p_actor, 'credits.revoke', 'user', l.user_id::text, trim(p_reason), jsonb_build_object('lot_id', l.id, 'credits_removed', v_left / 1000.0), p_ip);
  return jsonb_build_object('ok', true, 'credits_removed', v_left / 1000.0);
end $$;

-- 6. Product events (first party, no cookies, no raw addresses) ---------------------------------------------------------------

create table public.product_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event text not null check (event in ('page_view', 'calculator_completed', 'literature_search', 'signup_attribution')),
  user_id uuid references auth.users (id) on delete set null,
  authenticated boolean not null default false,
  -- A hash of address and browser that changes every day, so it counts visitors without being a lasting identifier.
  visitor text,
  path text,
  referrer_host text,
  utm_source text, utm_medium text, utm_campaign text,
  country text,
  device text check (device in ('desktop', 'mobile', 'tablet', 'other')),
  props jsonb not null default '{}'::jsonb
);
create index product_events_created_idx on public.product_events (created_at);
create index product_events_event_idx on public.product_events (event, created_at);
create index product_events_user_idx on public.product_events (user_id) where user_id is not null;
create unique index product_events_one_attribution on public.product_events (user_id) where event = 'signup_attribution';
alter table public.product_events enable row level security;
revoke all on table public.product_events from public, anon, authenticated;

create or replace function public.analytics_prune(p_days int default 400)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$ declare n int; begin delete from public.product_events where created_at < now() - make_interval(days => greatest(p_days, 30)); get diagnostics n = row_count; return n; end $$;

-- 7. Jobs, alerts, application errors -------------------------------------------------------------------------------------

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb not null default '{}'::jsonb,
  error text
);
create index job_runs_job_idx on public.job_runs (job, started_at desc);
alter table public.job_runs enable row level security;
revoke all on table public.job_runs from public, anon, authenticated;

create or replace function public.job_run_start(p_job text) returns bigint language sql security definer set search_path = public, pg_temp
as $$ insert into public.job_runs (job) values (left(p_job, 60)) returning id $$;
create or replace function public.job_run_finish(p_id bigint, p_ok boolean, p_summary jsonb default '{}'::jsonb, p_error text default null) returns void
language sql security definer set search_path = public, pg_temp
as $$ update public.job_runs set finished_at = now(), ok = p_ok, summary = coalesce(p_summary, '{}'::jsonb), error = left(p_error, 300) where id = p_id $$;

create table public.system_alerts (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null
);
-- One open alert per key: repeating the same finding does not pile up notifications.
create unique index system_alerts_open_key on public.system_alerts (dedupe_key) where acknowledged_at is null;
create index system_alerts_created_idx on public.system_alerts (created_at desc);
alter table public.system_alerts enable row level security;
revoke all on table public.system_alerts from public, anon, authenticated;

create table public.app_error_events (
  day date not null default current_date,
  fingerprint text not null,
  route text,
  name text,
  message text,
  occurrences int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (day, fingerprint)
);
alter table public.app_error_events enable row level security;
revoke all on table public.app_error_events from public, anon, authenticated;

create or replace function public.app_error_record(p_route text, p_name text, p_message text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_fp text := encode(sha256(convert_to(coalesce(p_route, '') || '|' || coalesce(p_name, '') || '|' || left(coalesce(p_message, ''), 120), 'UTF8')), 'hex');
begin
  insert into public.app_error_events (fingerprint, route, name, message) values (v_fp, left(p_route, 120), left(p_name, 60), left(p_message, 300))
  on conflict (day, fingerprint) do update set occurrences = public.app_error_events.occurrences + 1, last_seen = now();
end $$;

-- 8. Who was active -------------------------------------------------------------------------------------------------------------
-- "Active" means the person did something that was recorded: a project, calculation, reference, manuscript, PDF, assistant message,
-- AI request or generated document. Sign-ins are not recorded historically (only the latest one is kept by the auth service).

create or replace view public.admin_activity as
  select owner_id as user_id, created_at as at from public.studies
  union all select owner_id, last_activity_at from public.studies where last_activity_at is not null
  union all select created_by, created_at from public.saved_calculations where created_by is not null
  union all select s.owner_id, r.created_at from public.study_references r join public.studies s on s.id = r.study_id
  union all select created_by, updated_at from public.manuscripts where created_by is not null
  union all select owner_id, created_at from public.pdf_documents
  union all select owner_id, created_at from public.assistant_messages
  union all select user_id, created_at from public.ai_usage_events
  union all select generated_by, generated_at from public.generated_outputs where generated_by is not null;
revoke all on public.admin_activity from public, anon, authenticated;

-- 9. Reports ----------------------------------------------------------------------------------------------------------------------

create or replace function public.admin_overview(p_actor uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone p_tz) at time zone p_tz;
  v_month timestamptz := date_trunc('month', now() at time zone p_tz) at time zone p_tz;
  v_pct numeric := public.billing_setting_num('payment_fee_pct');
  v_fixed numeric := public.billing_setting_num('payment_fee_fixed_usd');
  v_infra numeric := (select value_num from public.billing_settings where key = 'monthly_infrastructure_cost_usd');
  v_cost numeric; v_usd numeric; v_usd_n int; v_usd_ref numeric; v_credit_value bigint := public.ai_setting('credit_value_micro_usd');
begin
  perform public.admin_assert(p_actor);
  select coalesce(sum(cost_micro_usd + platform_exposure_micro_usd), 0) / 1000000.0 into v_cost from public.ai_usage_events
   where created_at >= p_from and created_at < p_to and status <> 'reserved';
  select coalesce(sum(amount), 0), count(*) into v_usd, v_usd_n from public.payments
   where status in ('succeeded', 'refunded') and currency = 'USD' and fulfilled_at >= p_from and fulfilled_at < p_to;
  select coalesce(sum(amount), 0) into v_usd_ref from public.payments where status = 'refunded' and currency = 'USD' and refunded_at >= p_from and refunded_at < p_to;
  return jsonb_build_object(
    'tz', p_tz, 'from', p_from, 'to', p_to, 'computed_at', now(),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new_today', (select count(*) from auth.users where created_at >= v_today),
      'new_month', (select count(*) from auth.users where created_at >= v_month),
      'new_in_range', (select count(*) from auth.users where created_at >= p_from and created_at < p_to),
      'active_today', (select count(distinct user_id) from public.admin_activity where at >= v_today),
      'active_30d', (select count(distinct user_id) from public.admin_activity where at >= now() - interval '30 days'),
      'active_in_range', (select count(distinct user_id) from public.admin_activity where at >= p_from and at < p_to),
      'paying', (select count(*) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan where pl.is_paid and s.status = 'active' and s.current_period_end > now()),
      'paying_by_plan', coalesce((select jsonb_object_agg(plan, n) from (
          select s.plan, count(*) as n from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan
           where pl.is_paid and s.status = 'active' and s.current_period_end > now() group by s.plan) x), '{}'::jsonb),
      'suspended', (select count(*) from public.account_suspensions)),
    'revenue', jsonb_build_object(
      'gross_all_time', coalesce((select jsonb_agg(r) from (select currency, sum(amount) as amount, count(*) as payments from public.payments where status in ('succeeded', 'refunded') group by currency order by currency) r), '[]'::jsonb),
      'gross_month', coalesce((select jsonb_agg(r) from (select currency, sum(amount) as amount from public.payments where status in ('succeeded', 'refunded') and fulfilled_at >= v_month group by currency order by currency) r), '[]'::jsonb),
      'gross_range', coalesce((select jsonb_agg(r) from (select currency, kind, sum(amount) as amount, count(*) as payments from public.payments where status in ('succeeded', 'refunded') and fulfilled_at >= p_from and fulfilled_at < p_to group by currency, kind order by currency, kind) r), '[]'::jsonb),
      'refunds_range', coalesce((select jsonb_agg(r) from (select currency, sum(amount) as amount, count(*) as payments from public.payments where status = 'refunded' and refunded_at >= p_from and refunded_at < p_to group by currency) r), '[]'::jsonb),
      'mrr_usd', (select coalesce(sum(bp.amount), 0) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan
                   join public.billing_prices bp on bp.kind = 'plan' and bp.product_key = s.plan and bp.currency = 'USD' and bp.active
                  where pl.is_paid and s.status = 'active' and s.current_period_end > now()),
      'mrr_scheduled_to_end_usd', (select coalesce(sum(bp.amount), 0) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan
                   join public.billing_prices bp on bp.kind = 'plan' and bp.product_key = s.plan and bp.currency = 'USD' and bp.active
                  where pl.is_paid and s.status = 'active' and s.current_period_end > now() and s.cancel_at_period_end),
      'estimated_fees_usd', round(v_usd * v_pct / 100 + v_usd_n * v_fixed, 2),
      'ai_cost_usd', round(v_cost, 4),
      'infrastructure_monthly_usd', v_infra,
      'estimated_contribution_usd', round(v_usd - v_usd_ref - (v_usd * v_pct / 100 + v_usd_n * v_fixed) - v_cost, 2)),
    'ai', jsonb_build_object(
      'requests', (select count(*) from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved'),
      'input_tokens', (select coalesce(sum(input_tokens), 0) from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved'),
      'output_tokens', (select coalesce(sum(output_tokens), 0) from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved'),
      'cost_month_usd', (select round(coalesce(sum(cost_micro_usd + platform_exposure_micro_usd), 0) / 1000000.0, 4) from public.ai_usage_events where created_at >= v_month and status <> 'reserved'),
      'cost_range_usd', round(v_cost, 4),
      'active_users', (select count(distinct user_id) from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved'),
      'credits_consumed', (select coalesce(sum(charged_mcr), 0) / 1000.0 from public.ai_usage_events where created_at >= p_from and created_at < p_to),
      'purchased_balance_credits', (select coalesce(sum(credits_mcr - used_mcr), 0) / 1000.0 from public.ai_credit_lots where source = 'purchase' and expired_at is null and expires_at > now()),
      'credit_value_micro_usd', v_credit_value),
    'research', jsonb_build_object(
      'projects_total', (select count(*) from public.studies),
      'projects_month', (select count(*) from public.studies where created_at >= v_month),
      'projects_range', (select count(*) from public.studies where created_at >= p_from and created_at < p_to),
      'calculations_saved', (select count(*) from public.saved_calculations where created_at >= p_from and created_at < p_to),
      'calculator_completions_tracked', (select count(*) from public.product_events where event = 'calculator_completed' and created_at >= p_from and created_at < p_to),
      'references_saved', (select count(*) from public.study_references where created_at >= p_from and created_at < p_to),
      'documents_generated', (select count(*) from public.generated_outputs where generated_at >= p_from and generated_at < p_to),
      'supervisor_workspaces_in_use', (select count(distinct workspace_id) from public.study_supervisors)),
    'tracking', jsonb_build_object('events_since', (select min(created_at) from public.product_events)));
end $$;

create or replace function public.admin_users_page(p_actor uuid, p_search text default null, p_filter text default 'all', p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_out jsonb; v_q text := nullif(trim(coalesce(p_search, '')), ''); v_like text;
begin
  perform public.admin_assert(p_actor);
  v_like := case when v_q is null then null else '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  with scope as (
    select u.id, u.created_at from auth.users u left join public.profiles pr on pr.id = u.id
     where (v_like is null or lower(u.email) like v_like escape '\' or lower(coalesce(pr.full_name, '')) like v_like escape '\')
       and case coalesce(p_filter, 'all')
             when 'free' then public.billing_user_plan(u.id) = 'free'
             when 'pro' then public.billing_user_plan(u.id) = 'pro'
             when 'team' then public.billing_user_plan(u.id) = 'team'
             when 'suspended' then exists (select 1 from public.account_suspensions s where s.user_id = u.id)
             when 'recent' then u.created_at > now() - interval '7 days'
             when 'active' then exists (select 1 from public.admin_activity a where a.user_id = u.id and a.at > now() - interval '30 days')
             when 'inactive' then not exists (select 1 from public.admin_activity a where a.user_id = u.id and a.at > now() - interval '30 days')
             else true end
  ), page as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, pr.full_name, pr.role
      from scope sc join auth.users u on u.id = sc.id left join public.profiles pr on pr.id = u.id
     order by u.created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  )
  select jsonb_build_object('total', (select count(*) from scope), 'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', coalesce(p.full_name, ''), 'email', p.email, 'role', p.role, 'registered_at', p.created_at,
      'suspended', exists (select 1 from public.account_suspensions s where s.user_id = p.id),
      'is_admin', exists (select 1 from public.app_admins a where a.user_id = p.id),
      'plan', public.billing_user_plan(p.id),
      'last_activity', greatest(p.last_sign_in_at, (select max(at) from public.admin_activity a where a.user_id = p.id)),
      'projects', (select count(*) from public.studies s where s.owner_id = p.id),
      'credits_available', (public.ai_get_headroom(p.id) ->> 'available_mcr')::numeric / 1000.0,
      'verified_payments', coalesce((select jsonb_agg(x) from (select currency, sum(amount) as amount, count(*) as payments from public.payments pa
                                      where pa.user_id = p.id and pa.status in ('succeeded', 'refunded') group by currency) x), '[]'::jsonb)) order by p.created_at desc), '[]'::jsonb))
    into v_out from page p;
  return v_out;
end $$;

create or replace function public.admin_user_detail(p_actor uuid, p_user uuid, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public.admin_assert(p_actor);
  if not exists (select 1 from auth.users where id = p_user) then return null; end if;
  -- Looking at an account is itself recorded. Only counts and timestamps are shown: never project titles or research content.
  perform public.admin_audit_write(p_actor, 'user.view', 'user', p_user::text, null, '{}'::jsonb, p_ip);
  select jsonb_build_object(
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'name', pr.full_name, 'role', pr.role, 'institution', pr.institution,
                  'registered_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'is_admin', exists (select 1 from public.app_admins a where a.user_id = u.id))
                 from auth.users u left join public.profiles pr on pr.id = u.id where u.id = p_user),
    'suspension', (select to_jsonb(s) - 'user_id' from public.account_suspensions s where s.user_id = p_user),
    'plan', public.billing_user_plan(p_user),
    'subscription', (select to_jsonb(s) - 'user_id' from public.ai_subscriptions s where s.user_id = p_user),
    'subscription_events', coalesce((select jsonb_agg(e) from (select event_time, plan, status, provider from public.ai_subscription_events where user_id = p_user order by event_time desc limit 20) e), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(p) from (select id, created_at, fulfilled_at, refunded_at, provider, kind, product_key, amount, currency, status, method, failure_reason
                                                     from public.payments where user_id = p_user order by created_at desc limit 50) p), '[]'::jsonb),
    'headroom', public.ai_get_headroom(p_user),
    'lots', coalesce((select jsonb_agg(l) from (select id, source, credits_mcr / 1000.0 as credits, used_mcr / 1000.0 as used, reserved_mcr / 1000.0 as reserved, granted_at, expires_at, expired_at, note
                                                 from public.ai_credit_lots where user_id = p_user order by granted_at desc limit 30) l), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(t) from (select tr.id, tr.created_at, tr.kind, tr.pool, tr.amount_mcr / 1000.0 as credits, tr.note,
                                                               ev.feature_key, ev.model_id
                                                          from public.ai_credit_transactions tr left join public.ai_usage_events ev on ev.id = tr.event_id
                                                         where tr.user_id = p_user order by tr.id desc limit 100) t), '[]'::jsonb),
    'ai', jsonb_build_object(
      'requests', (select count(*) from public.ai_usage_events where user_id = p_user and status <> 'reserved'),
      'cost_usd', (select round(coalesce(sum(cost_micro_usd + platform_exposure_micro_usd), 0) / 1000000.0, 4) from public.ai_usage_events where user_id = p_user and status <> 'reserved'),
      'recent', coalesce((select jsonb_agg(e) from (select created_at, feature_key, model_id, status, charged_mcr / 1000.0 as credits, cost_micro_usd / 1000000.0 as cost_usd, input_tokens, output_tokens, error_code
                                                      from public.ai_usage_events where user_id = p_user order by created_at desc limit 30) e), '[]'::jsonb)),
    'counts', jsonb_build_object(
      'projects', (select count(*) from public.studies where owner_id = p_user),
      'saved_calculations', (select count(*) from public.saved_calculations where created_by = p_user),
      'references', (select count(*) from public.study_references r join public.studies s on s.id = r.study_id where s.owner_id = p_user),
      'manuscripts', (select count(*) from public.manuscripts where created_by = p_user),
      'pdfs', (select count(*) from public.pdf_documents where owner_id = p_user),
      'documents', (select count(*) from public.generated_outputs where generated_by = p_user),
      'supervised_projects', (select count(*) from public.study_supervisors where supervisor_id = p_user),
      'invitations_sent', (select count(*) from public.supervisor_invitations where invited_by = p_user)),
    'recent_activity', coalesce((select jsonb_agg(a) from (select at, kind from (
        select created_at as at, 'project created' as kind from public.studies where owner_id = p_user
        union all select created_at, 'calculation saved' from public.saved_calculations where created_by = p_user
        union all select generated_at, 'document generated' from public.generated_outputs where generated_by = p_user
        union all select created_at, 'AI request' from public.ai_usage_events where user_id = p_user
        union all select created_at, 'PDF uploaded' from public.pdf_documents where owner_id = p_user) x order by at desc limit 15) a), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(a) from (select created_at, actor_email, action, reason from public.admin_audit_log where target_type = 'user' and target_id = p_user::text and action <> 'user.view' order by id desc limit 20) a), '[]'::jsonb)
  ) into v;
  return v;
end $$;

create or replace function public.admin_subscriptions(p_actor uuid, p_from timestamptz, p_to timestamptz, p_filter text default 'all', p_search text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_out jsonb; v_q text := nullif(trim(coalesce(p_search, '')), ''); v_like text; v_summary jsonb;
begin
  perform public.admin_assert(p_actor);
  v_like := case when v_q is null then null else '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  with s as (
    select s2.*, u.email,
           case when s2.status = 'active' and s2.current_period_end > now() and s2.cancel_at_period_end then 'ending'
                when s2.status = 'active' and s2.current_period_end > now() then 'active'
                when s2.status = 'past_due' then 'past_due' else 'expired' end as state
      from public.ai_subscriptions s2 join public.plans pl on pl.plan_key = s2.plan and pl.is_paid left join auth.users u on u.id = s2.user_id
     where v_like is null or lower(u.email) like v_like escape '\'
  ), picked as (
    select * from s where coalesce(p_filter, 'all') = 'all' or state = p_filter
     order by updated_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  )
  select jsonb_build_object('total', (select count(*) from s where coalesce(p_filter, 'all') = 'all' or state = p_filter),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'email', p.email, 'plan', p.plan, 'status', p.status, 'state', p.state, 'cancel_at_period_end', p.cancel_at_period_end,
      'current_period_start', p.current_period_start, 'current_period_end', p.current_period_end, 'provider', p.provider, 'provider_subscription_id', p.provider_subscription_id,
      'price_usd', (select bp.amount from public.billing_prices bp where bp.kind = 'plan' and bp.product_key = p.plan and bp.currency = 'USD' and bp.active),
      'currency', 'USD', 'period', 'month',
      'started_at', (select min(pa.fulfilled_at) from public.payments pa where pa.user_id = p.user_id and pa.kind = 'subscription' and pa.status in ('succeeded', 'refunded'))) order by p.updated_at desc), '[]'::jsonb))
    into v_out from picked p;
  v_summary := jsonb_build_object(
      'users_total', (select count(*) from auth.users),
      'active_paid', (select count(*) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan where pl.is_paid and s.status = 'active' and s.current_period_end > now()),
      'active_by_plan', coalesce((select jsonb_object_agg(plan, n) from (select s.plan, count(*) as n from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan
                                    where pl.is_paid and s.status = 'active' and s.current_period_end > now() group by s.plan) x), '{}'::jsonb),
      'scheduled_to_end', (select count(*) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan where pl.is_paid and s.status = 'active' and s.current_period_end > now() and s.cancel_at_period_end),
      'expired', (select count(*) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan where pl.is_paid and (s.status in ('expired', 'canceled') or (s.status = 'active' and s.current_period_end <= now()))),
      'past_due', (select count(*) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan where pl.is_paid and s.status = 'past_due'),
      'new_in_range', (select count(*) from (select user_id, min(fulfilled_at) as first from public.payments where kind = 'subscription' and status in ('succeeded', 'refunded') group by user_id) f where f.first >= p_from and f.first < p_to),
      'renewals_in_range', (select count(*) from public.payments p where p.kind = 'subscription' and p.status in ('succeeded', 'refunded') and p.fulfilled_at >= p_from and p.fulfilled_at < p_to
                              and exists (select 1 from public.payments q where q.user_id = p.user_id and q.kind = 'subscription' and q.status in ('succeeded', 'refunded') and q.fulfilled_at < p.fulfilled_at)),
      'failed_payments_in_range', (select count(*) from public.payments where kind = 'subscription' and status = 'failed' and created_at >= p_from and created_at < p_to),
      'registered_in_range', (select count(*) from auth.users where created_at >= p_from and created_at < p_to),
      'registered_in_range_now_paid', (select count(distinct u.id) from auth.users u where u.created_at >= p_from and u.created_at < p_to
                                         and exists (select 1 from public.payments p where p.user_id = u.id and p.kind = 'subscription' and p.status in ('succeeded', 'refunded'))));
  return v_out || jsonb_build_object('summary', v_summary);
end $$;

create or replace function public.admin_credits(p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_cv bigint := public.ai_setting('credit_value_micro_usd'); v_avail_sub numeric; v_avail_lots numeric; v_reserved numeric;
begin
  perform public.admin_assert(p_actor);
  -- Unspent allowance in periods that are still running.
  select coalesce(sum(greatest(allowance_mcr - used_mcr - reserved_mcr, 0)), 0) into v_avail_sub from public.ai_credit_periods
   where period_end is null or period_end > now();
  select coalesce(sum(greatest(credits_mcr - used_mcr - reserved_mcr, 0)), 0) into v_avail_lots from public.ai_credit_lots where expired_at is null and expires_at > now();
  select coalesce((select sum(reserved_mcr) from public.ai_credit_periods where period_end is null or period_end > now()), 0)
       + coalesce((select sum(reserved_mcr) from public.ai_credit_lots where expired_at is null), 0) into v_reserved;
  return jsonb_build_object(
    'allocated', jsonb_build_object(
      'subscription_credits', (select coalesce(sum(allowance_mcr), 0) / 1000.0 from public.ai_credit_periods where kind = 'pro'),
      'introductory_credits', (select coalesce(sum(allowance_mcr), 0) / 1000.0 from public.ai_credit_periods where kind = 'intro'),
      'purchased_credits', (select coalesce(sum(credits_mcr), 0) / 1000.0 from public.ai_credit_lots where source = 'purchase'),
      'granted_credits', (select coalesce(sum(credits_mcr), 0) / 1000.0 from public.ai_credit_lots where source = 'grant')),
    'consumed', jsonb_build_object(
      'subscription_pool', (select coalesce(sum(used_mcr), 0) / 1000.0 from public.ai_credit_periods),
      'purchased_pool', (select coalesce(-sum(amount_mcr), 0) / 1000.0 from public.ai_credit_transactions where kind = 'usage' and pool = 'purchased')),
    'expired_credits', (select coalesce(-sum(amount_mcr), 0) / 1000.0 from public.ai_credit_transactions where kind = 'expiry'),
    'reserved_now', v_reserved / 1000.0,
    'available', jsonb_build_object('subscription', v_avail_sub / 1000.0, 'purchased_and_granted', v_avail_lots / 1000.0, 'total', (v_avail_sub + v_avail_lots) / 1000.0),
    'exposure_usd', round((v_avail_sub + v_avail_lots) / 1000.0 * v_cv / 1000000.0, 2),
    'exposure_note', 'Worst case if every available credit were spent: credits times the AI cost one credit stands for. Unspent subscription credits expire at period end.',
    'deferred_purchase_revenue_usd', (select round(coalesce(sum(p.amount * (l.credits_mcr - l.used_mcr)::numeric / l.credits_mcr), 0), 2) from public.ai_credit_lots l join public.payments p on p.id = l.payment_id
                                        where l.source = 'purchase' and l.expired_at is null and l.expires_at > now() and p.currency = 'USD' and p.status = 'succeeded'),
    'credit_value_micro_usd', v_cv,
    'top_users', coalesce((select jsonb_agg(r) from (
        select u.email, round(sum(e.charged_mcr) / 1000.0, 1) as credits, count(*) as requests, round(sum(e.cost_micro_usd) / 1000000.0, 4) as cost_usd
          from public.ai_usage_events e join auth.users u on u.id = e.user_id where e.created_at > now() - interval '30 days' and e.status = 'committed'
         group by u.email order by sum(e.charged_mcr) desc limit 10) r), '[]'::jsonb),
    'ledger_check', jsonb_build_object(
      'lots_overdrawn', (select count(*) from public.ai_credit_lots where used_mcr > credits_mcr),
      'periods_overdrawn', (select count(*) from public.ai_credit_periods where used_mcr > allowance_mcr + reserved_mcr),
      'negative_reserved', (select count(*) from public.ai_credit_lots where reserved_mcr < 0) + (select count(*) from public.ai_credit_periods where reserved_mcr < 0)));
end $$;

create or replace function public.admin_credit_transactions(p_actor uuid, p_user uuid, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor);
  return jsonb_build_object(
    'total', (select count(*) from public.ai_credit_transactions where user_id = p_user),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.id desc) from (
      select tr.id, tr.created_at, tr.user_id, tr.kind, tr.pool, tr.amount_mcr / 1000.0 as credits, tr.note,
             sum(tr.amount_mcr) over (partition by tr.pool order by tr.id) / 1000.0 as pool_running_balance,
             ev.feature_key as operation, ev.model_id as model,
             case when ev.period_id is not null then (select cp.period_start from public.ai_credit_periods cp where cp.id = ev.period_id) end as billing_period_start,
             lot.source as credit_source
        from public.ai_credit_transactions tr left join public.ai_usage_events ev on ev.id = tr.event_id left join public.ai_credit_lots lot on lot.id = tr.lot_id
       where tr.user_id = p_user order by tr.id desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) r), '[]'::jsonb));
end $$;

create or replace function public.admin_revenue(p_actor uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_pct numeric := public.billing_setting_num('payment_fee_pct'); v_fixed numeric := public.billing_setting_num('payment_fee_fixed_usd');
        v_infra numeric := (select value_num from public.billing_settings where key = 'monthly_infrastructure_cost_usd');
        v_gross numeric; v_n int; v_ref numeric; v_ai numeric; v_days numeric := greatest(extract(epoch from (p_to - p_from)) / 86400.0, 0);
begin
  perform public.admin_assert(p_actor);
  select coalesce(sum(amount), 0), count(*) into v_gross, v_n from public.payments where status in ('succeeded', 'refunded') and currency = 'USD' and fulfilled_at >= p_from and fulfilled_at < p_to;
  select coalesce(sum(amount), 0) into v_ref from public.payments where status = 'refunded' and currency = 'USD' and refunded_at >= p_from and refunded_at < p_to;
  select coalesce(sum(cost_micro_usd + platform_exposure_micro_usd), 0) / 1000000.0 into v_ai from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved';
  return jsonb_build_object(
    'tz', p_tz, 'from', p_from, 'to', p_to,
    'by_currency', coalesce((select jsonb_agg(r) from (
        select currency,
               sum(amount) filter (where kind = 'subscription') as subscription,
               sum(amount) filter (where kind = 'pack') as credit_topups,
               sum(amount) as gross, count(*) as payments
          from public.payments where status in ('succeeded', 'refunded') and fulfilled_at >= p_from and fulfilled_at < p_to group by currency order by currency) r), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(r) from (select currency, sum(amount) as amount, count(*) as payments from public.payments where status = 'refunded' and refunded_at >= p_from and refunded_at < p_to group by currency) r), '[]'::jsonb),
    'pending', (select jsonb_build_object('payments', count(*), 'amount_usd', coalesce(sum(amount) filter (where currency = 'USD'), 0)) from public.payments where status = 'pending' and created_at > now() - interval '2 days'),
    'usd', jsonb_build_object(
      'gross', v_gross, 'refunds', v_ref, 'estimated_fees', round(v_gross * v_pct / 100 + v_n * v_fixed, 2),
      'net_collected_estimate', round(v_gross - v_ref - (v_gross * v_pct / 100 + v_n * v_fixed), 2),
      'ai_cost', round(v_ai, 4),
      'infrastructure_cost', case when v_infra is null then null else round(v_infra * v_days / 30.0, 2) end,
      'estimated_contribution', round(v_gross - v_ref - (v_gross * v_pct / 100 + v_n * v_fixed) - v_ai - coalesce(v_infra * v_days / 30.0, 0), 2),
      'contribution_excludes_infrastructure', v_infra is null,
      'chargebacks', null),
    'by_plan', coalesce((select jsonb_agg(r) from (select product_key as plan, currency, sum(amount) as amount, count(*) as payments from public.payments
                                                   where kind = 'subscription' and status in ('succeeded', 'refunded') and fulfilled_at >= p_from and fulfilled_at < p_to group by 1, 2 order by 3 desc) r), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(r order by r.day) from (
        select d.day,
               coalesce((select sum(amount) from public.payments p where p.status in ('succeeded', 'refunded') and p.currency = 'USD' and p.kind = 'subscription'
                          and (p.fulfilled_at at time zone p_tz)::date = d.day), 0) as subscription_usd,
               coalesce((select sum(amount) from public.payments p where p.status in ('succeeded', 'refunded') and p.currency = 'USD' and p.kind = 'pack'
                          and (p.fulfilled_at at time zone p_tz)::date = d.day), 0) as topups_usd,
               coalesce((select sum(cost_micro_usd + platform_exposure_micro_usd) / 1000000.0 from public.ai_usage_events e where e.status <> 'reserved'
                          and (e.created_at at time zone p_tz)::date = d.day), 0) as ai_cost_usd,
               (select count(*) from (select user_id, min(fulfilled_at) as first from public.payments where kind = 'subscription' and status in ('succeeded', 'refunded') group by user_id) f
                 where (f.first at time zone p_tz)::date <= d.day) as cumulative_subscribers
          from generate_series((p_from at time zone p_tz)::date, ((p_to - interval '1 second') at time zone p_tz)::date, interval '1 day') as d(day)) r), '[]'::jsonb));
end $$;

create or replace function public.admin_ai_usage(p_actor uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_month timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'; v_day date := public.ai_utc_day(now());
begin
  perform public.admin_assert(p_actor);
  return jsonb_build_object(
    'tz', p_tz, 'from', p_from, 'to', p_to,
    'totals', (select jsonb_build_object(
        'requests', count(*), 'completed', count(*) filter (where status = 'committed'), 'failed', count(*) filter (where status in ('failed', 'expired')),
        'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0),
        'cache_read_tokens', coalesce(sum(cache_read_tokens), 0), 'cache_write_tokens', coalesce(sum(cache_write_5m_tokens + cache_write_1h_tokens), 0),
        'tool_calls', coalesce(sum(tool_calls), 0),
        'cost_usd', round(coalesce(sum(cost_micro_usd + platform_exposure_micro_usd), 0) / 1000000.0, 4),
        'avg_cost_usd', round(coalesce(avg(cost_micro_usd + platform_exposure_micro_usd) filter (where status = 'committed'), 0) / 1000000.0, 6),
        'avg_seconds', round(coalesce(avg(extract(epoch from (finished_at - created_at))) filter (where status = 'committed' and finished_at is not null), 0)::numeric, 1),
        'unknown_usage', count(*) filter (where not usage_known))
        from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved'),
    'by_feature', coalesce((select jsonb_agg(r) from (select feature_key, count(*) as requests, count(*) filter (where status in ('failed', 'expired')) as failed,
        round(sum(cost_micro_usd + platform_exposure_micro_usd) / 1000000.0, 4) as cost_usd, round(sum(charged_mcr) / 1000.0, 1) as credits,
        round(avg(cost_micro_usd) filter (where status = 'committed') / 1000000.0, 5) as avg_cost_usd
        from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved' group by 1 order by 4 desc) r), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(r) from (select model_id, count(*) as requests, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
        round(sum(cost_micro_usd + platform_exposure_micro_usd) / 1000000.0, 4) as cost_usd
        from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved' group by 1 order by 5 desc) r), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(r) from (select coalesce(error_code, 'none recorded') as code, count(*) as requests from public.ai_usage_events
        where created_at >= p_from and created_at < p_to and status in ('failed', 'expired') group by 1 order by 2 desc limit 10) r), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(r order by r.day) from (select (created_at at time zone p_tz)::date as day, count(*) as requests,
        round(sum(cost_micro_usd + platform_exposure_micro_usd) / 1000000.0, 4) as cost_usd
        from public.ai_usage_events where created_at >= p_from and created_at < p_to and status <> 'reserved' group by 1) r), '[]'::jsonb),
    'most_expensive', coalesce((select jsonb_agg(r) from (select e.created_at, u.email, e.feature_key, e.model_id, e.status, e.iterations, e.tool_calls,
        round((e.cost_micro_usd + e.platform_exposure_micro_usd) / 1000000.0, 4) as cost_usd, e.input_tokens, e.output_tokens
        from public.ai_usage_events e left join auth.users u on u.id = e.user_id
       where e.created_at >= p_from and e.created_at < p_to and e.status <> 'reserved' order by e.cost_micro_usd + e.platform_exposure_micro_usd desc limit 10) r), '[]'::jsonb),
    'near_limit', coalesce((select jsonb_agg(r) from (select u.email, round(cp.used_mcr / 1000.0, 1) as used, round(cp.allowance_mcr / 1000.0, 1) as allowance,
        round(100.0 * (cp.used_mcr + cp.reserved_mcr) / nullif(cp.allowance_mcr, 0), 0) as pct
        from public.ai_credit_periods cp join auth.users u on u.id = cp.user_id
       where (cp.period_end is null or cp.period_end > now()) and cp.allowance_mcr > 0 and (cp.used_mcr + cp.reserved_mcr) >= 0.8 * cp.allowance_mcr
       order by 4 desc limit 15) r), '[]'::jsonb),
    'budget', jsonb_build_object(
      'daily_budget_usd', public.ai_setting('platform_daily_budget_micro_usd') / 1000000.0,
      'today_spent_usd', (select coalesce(spent_micro_usd, 0) / 1000000.0 from public.ai_platform_days where day = v_day),
      'today_reserved_usd', (select coalesce(reserved_micro_usd, 0) / 1000000.0 from public.ai_platform_days where day = v_day),
      'monthly_budget_usd', public.ai_setting('platform_monthly_budget_micro_usd') / 1000000.0,
      'month_spent_usd', (select round(coalesce(sum(spent_micro_usd), 0) / 1000000.0, 4) from public.ai_platform_days where day >= (v_month at time zone 'UTC')::date)),
    'alerts', coalesce((select jsonb_agg(r) from (select day, threshold_pct, spent_micro_usd / 1000000.0 as spent_usd, budget_micro_usd / 1000000.0 as budget_usd, created_at
        from public.ai_budget_alerts order by created_at desc limit 10) r), '[]'::jsonb),
    'limits', jsonb_build_object(
      'features', coalesce((select jsonb_agg(r) from (select feature_key, enabled, max_iterations, max_tool_calls, max_op_cost_micro_usd / 1000000.0 as max_op_cost_usd, max_output_tokens
                                from public.ai_features order by feature_key) r), '[]'::jsonb),
      'settings', coalesce((select jsonb_agg(r) from (select key, value_num, description from public.ai_settings order by key) r), '[]'::jsonb)));
end $$;

create or replace function public.admin_research(p_actor uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor);
  return jsonb_build_object(
    'tz', p_tz, 'from', p_from, 'to', p_to, 'tracking_since', (select min(created_at) from public.product_events),
    'counts', jsonb_build_object(
      'projects_created', (select count(*) from public.studies where created_at >= p_from and created_at < p_to),
      'protocols_locked', (select count(*) from public.protocol_versions where status = 'registered' and registered_at >= p_from and registered_at < p_to),
      'sample_size_and_stat_calculations_saved', (select count(*) from public.saved_calculations where created_at >= p_from and created_at < p_to),
      'calculator_completions_tracked', (select count(*) from public.product_events where event = 'calculator_completed' and created_at >= p_from and created_at < p_to),
      'references_saved', (select count(*) from public.study_references where created_at >= p_from and created_at < p_to),
      'references_by_source', coalesce((select jsonb_object_agg(coalesce(source, 'unknown'), n) from (select source, count(*) as n from public.study_references where created_at >= p_from and created_at < p_to group by 1) x), '{}'::jsonb),
      'literature_searches_tracked', (select count(*) from public.product_events where event = 'literature_search' and created_at >= p_from and created_at < p_to),
      'documents_generated', (select count(*) from public.generated_outputs where generated_at >= p_from and generated_at < p_to),
      'documents_by_type', coalesce((select jsonb_object_agg(output_type::text, n) from (select output_type, count(*) as n from public.generated_outputs where generated_at >= p_from and generated_at < p_to group by 1) x), '{}'::jsonb),
      'manuscripts_created', (select count(*) from public.manuscripts where created_at >= p_from and created_at < p_to),
      'pdfs_uploaded', (select count(*) from public.pdf_documents where created_at >= p_from and created_at < p_to),
      'assistant_messages', (select count(*) from public.assistant_messages where created_at >= p_from and created_at < p_to),
      'supervisor_review_requests', (select count(*) from public.protocol_versions where approval_requested_at >= p_from and approval_requested_at < p_to),
      'supervisor_invitations', (select count(*) from public.supervisor_invitations where created_at >= p_from and created_at < p_to),
      'supervisors_attached', (select count(*) from public.study_supervisors where attached_at >= p_from and attached_at < p_to),
      'active_supervisor_workspaces', (select count(distinct workspace_id) from public.study_supervisors)),
    'top_tools', coalesce((select jsonb_agg(r) from (select tool_slug, max(tool_name) as name, count(*) as saved from public.saved_calculations where created_at >= p_from and created_at < p_to group by 1 order by 3 desc limit 10) r), '[]'::jsonb),
    'top_tools_tracked', coalesce((select jsonb_agg(r) from (select props ->> 'tool' as tool, count(*) as completions from public.product_events where event = 'calculator_completed' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 10) r), '[]'::jsonb),
    'ai_features', coalesce((select jsonb_agg(r) from (select feature_key, count(*) as requests from public.ai_usage_events where created_at >= p_from and created_at < p_to and status = 'committed' group by 1 order by 2 desc) r), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(r order by r.day) from (
        select d.day,
          (select count(*) from public.studies s where (s.created_at at time zone p_tz)::date = d.day) as projects,
          (select count(*) from public.saved_calculations c where (c.created_at at time zone p_tz)::date = d.day) as calculations,
          (select count(*) from public.study_references x where (x.created_at at time zone p_tz)::date = d.day) as refs,
          (select count(*) from public.generated_outputs g where (g.generated_at at time zone p_tz)::date = d.day) as documents
          from generate_series((p_from at time zone p_tz)::date, ((p_to - interval '1 second') at time zone p_tz)::date, interval '1 day') as d(day)) r), '[]'::jsonb));
end $$;

create or replace function public.admin_traffic(p_actor uuid, p_from timestamptz, p_to timestamptz, p_tz text default 'UTC')
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor);
  return jsonb_build_object(
    'tz', p_tz, 'from', p_from, 'to', p_to, 'tracking_since', (select min(created_at) from public.product_events where event = 'page_view'),
    'totals', (select jsonb_build_object('page_views', count(*), 'visitor_days', count(distinct visitor || (created_at at time zone 'UTC')::date::text),
                 'authenticated_views', count(*) filter (where authenticated), 'anonymous_views', count(*) filter (where not authenticated))
                from public.product_events where event = 'page_view' and created_at >= p_from and created_at < p_to),
    'series', coalesce((select jsonb_agg(r order by r.day) from (select (created_at at time zone p_tz)::date as day, count(*) as page_views,
        count(distinct visitor) as visitors from public.product_events where event = 'page_view' and created_at >= p_from and created_at < p_to group by 1) r), '[]'::jsonb),
    'top_pages', coalesce((select jsonb_agg(r) from (select path, count(*) as views, count(distinct visitor) as visitors from public.product_events where event = 'page_view' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 15) r), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(r) from (select coalesce(referrer_host, '(direct or none)') as referrer, count(*) as views from public.product_events where event = 'page_view' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 15) r), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(r) from (select coalesce(utm_source, case when referrer_host is null then 'direct' else 'referral' end) as source, count(*) as views from public.product_events where event = 'page_view' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 10) r), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(r) from (select coalesce(country, 'unknown') as country, count(*) as views from public.product_events where event = 'page_view' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 15) r), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(r) from (select coalesce(device, 'other') as device, count(*) as views from public.product_events where event = 'page_view' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc) r), '[]'::jsonb),
    'landing_pages', coalesce((select jsonb_agg(r) from (select path, count(*) as entries from (
        select distinct on (visitor, (created_at at time zone 'UTC')::date) path from public.product_events
         where event = 'page_view' and visitor is not null and created_at >= p_from and created_at < p_to order by visitor, (created_at at time zone 'UTC')::date, created_at) f
        group by 1 order by 2 desc limit 10) r), '[]'::jsonb));
end $$;

create or replace function public.admin_funnel(p_actor uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor);
  return (with cohort as (select id from auth.users where created_at >= p_from and created_at < p_to)
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'tracking_since', (select min(created_at) from public.product_events where event = 'page_view'),
      'visitors', (select count(distinct visitor || (created_at at time zone 'UTC')::date::text) from public.product_events where event = 'page_view' and not authenticated and created_at >= p_from and created_at < p_to),
      'stages', jsonb_build_array(
        jsonb_build_object('key', 'registered', 'label', 'Free registration', 'count', (select count(*) from cohort)),
        jsonb_build_object('key', 'tool', 'label', 'First research activity', 'count', (select count(*) from cohort c where exists (select 1 from public.admin_activity a where a.user_id = c.id))),
        jsonb_build_object('key', 'project', 'label', 'First project created', 'count', (select count(*) from cohort c where exists (select 1 from public.studies s where s.owner_id = c.id))),
        jsonb_build_object('key', 'pro', 'label', 'Paid subscription', 'count', (select count(*) from cohort c where exists (select 1 from public.payments p where p.user_id = c.id and p.kind = 'subscription' and p.status in ('succeeded', 'refunded'))))),
      'campaigns', coalesce((select jsonb_agg(r) from (
          select coalesce(e.utm_campaign, '(none)') as campaign, coalesce(e.utm_source, '(none)') as source, count(*) as registrations,
                 count(*) filter (where exists (select 1 from public.admin_activity a where a.user_id = e.user_id)) as active,
                 count(*) filter (where exists (select 1 from public.studies s where s.owner_id = e.user_id)) as with_project,
                 count(*) filter (where exists (select 1 from public.payments p where p.user_id = e.user_id and p.kind = 'subscription' and p.status in ('succeeded', 'refunded'))) as paid
            from public.product_events e where e.event = 'signup_attribution' and e.created_at >= p_from and e.created_at < p_to group by 1, 2 order by 3 desc limit 15) r), '[]'::jsonb)));
end $$;

-- Looks for things that need a person. Called by the daily job and when the dashboard loads. A repeated finding does not duplicate.
create or replace function public.system_alert_raise(p_kind text, p_severity text, p_message text, p_details jsonb, p_key text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  insert into public.system_alerts (kind, severity, message, details, dedupe_key) values (p_kind, p_severity, left(p_message, 300), coalesce(p_details, '{}'::jsonb), left(p_key, 160))
  on conflict (dedupe_key) where acknowledged_at is null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function public.admin_scan_alerts()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_new int := 0; n int; v_day date := public.ai_utc_day(now()); v_spent numeric; v_budget numeric; v_median numeric; v_hourly numeric; v_last numeric;
begin
  -- Failed subscription renewals in the last day.
  select count(*) into n from public.payments where kind = 'subscription' and status = 'failed' and created_at > now() - interval '24 hours' and (meta ->> 'renewal') = 'true';
  if n > 0 and public.system_alert_raise('failed_renewals', 'warning', n || ' subscription renewal payment(s) failed in the last 24 hours.', jsonb_build_object('count', n), 'failed_renewals:' || v_day) then v_new := v_new + 1; end if;
  -- AI spend well above a normal day, or most of the daily budget.
  select coalesce(spent_micro_usd, 0), coalesce(budget_micro_usd, public.ai_setting('platform_daily_budget_micro_usd')) into v_spent, v_budget from public.ai_platform_days where day = v_day;
  select coalesce(percentile_cont(0.5) within group (order by spent_micro_usd), 0) into v_median from public.ai_platform_days where day >= v_day - 14 and day < v_day;
  if coalesce(v_spent, 0) > 0 and v_median > 0 and v_spent > greatest(v_median * 3, 1000000) then
    if public.system_alert_raise('abnormal_ai_spend', 'warning', 'AI spend today is more than three times a typical day.', jsonb_build_object('spent_usd', v_spent / 1000000.0, 'median_usd', v_median / 1000000.0), 'ai_spend:' || v_day) then v_new := v_new + 1; end if;
  end if;
  if coalesce(v_spent, 0) >= 0.9 * v_budget and v_budget > 0 then
    if public.system_alert_raise('ai_budget_near_limit', 'critical', 'AI spend today has reached 90 percent of the daily platform budget.', jsonb_build_object('spent_usd', v_spent / 1000000.0, 'budget_usd', v_budget / 1000000.0), 'ai_budget:' || v_day) then v_new := v_new + 1; end if;
  end if;
  -- Credits issued without an audit entry (not through the console).
  select count(*) into n from public.ai_credit_lots l where l.source = 'grant' and l.granted_at > now() - interval '7 days'
     and not exists (select 1 from public.admin_audit_log a where a.action = 'credits.grant' and a.details ->> 'lot_id' = l.id::text);
  if n > 0 and public.system_alert_raise('unexpected_credit_issuance', 'critical', n || ' credit grant(s) exist with no matching audit entry.', jsonb_build_object('count', n), 'credit_grants_unaudited:' || v_day) then v_new := v_new + 1; end if;
  -- Unusual number of new accounts.
  select count(*) into v_last from auth.users where created_at > now() - interval '1 hour';
  select count(*) / (7 * 24.0) into v_hourly from auth.users where created_at > now() - interval '7 days' and created_at <= now() - interval '1 hour';
  if v_last >= 20 and v_last > v_hourly * 5 then
    if public.system_alert_raise('registration_spike', 'warning', v_last || ' accounts were created in the last hour.', jsonb_build_object('last_hour', v_last, 'typical_per_hour', round(v_hourly, 2)), 'registrations:' || to_char(now(), 'YYYY-MM-DD-HH24')) then v_new := v_new + 1; end if;
  end if;
  -- Provider events that could not be processed.
  select count(*) into n from public.payment_events where received_at > now() - interval '2 days' and received_at < now() - interval '15 minutes' and outcome = 'received';
  if n >= 3 and public.system_alert_raise('webhook_failures', 'critical', n || ' payment provider events were received but never finished processing.', jsonb_build_object('count', n), 'webhooks:' || to_char(now(), 'YYYY-MM-DD-HH24')) then v_new := v_new + 1; end if;
  -- Application errors that keep happening.
  select coalesce(sum(occurrences), 0) into n from public.app_error_events where day = current_date;
  if n >= 25 and public.system_alert_raise('application_errors', 'warning', n || ' unhandled application errors today.', jsonb_build_object('count', n), 'app_errors:' || current_date) then v_new := v_new + 1; end if;
  -- Storage close to the limit the owner configured (skipped when no limit is set).
  select value_num into v_budget from public.billing_settings where key = 'storage_budget_bytes';
  if v_budget is not null and v_budget > 0 then
    select coalesce(sum(file_size), 0) into v_spent from public.pdf_documents;
    if v_spent >= 0.8 * v_budget and public.system_alert_raise('storage_near_limit', 'warning', 'Stored PDFs have reached 80 percent of the configured storage budget.', jsonb_build_object('bytes', v_spent, 'budget', v_budget), 'storage:' || to_char(now(), 'YYYY-MM')) then v_new := v_new + 1; end if;
  end if;
  -- The daily job has stopped running.
  if exists (select 1 from public.job_runs) and not exists (select 1 from public.job_runs where job = 'billing_maintenance' and started_at > now() - interval '36 hours') then
    if public.system_alert_raise('job_not_running', 'warning', 'The daily maintenance job has not run for more than 36 hours.', '{}'::jsonb, 'job_stale:' || v_day) then v_new := v_new + 1; end if;
  end if;
  return jsonb_build_object('new_alerts', v_new);
end $$;

create or replace function public.admin_system(p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor);
  return jsonb_build_object(
    'alerts', coalesce((select jsonb_agg(r) from (select id, created_at, kind, severity, message, details, acknowledged_at from public.system_alerts order by acknowledged_at is not null, created_at desc limit 30) r), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(r) from (select job, started_at, finished_at, ok, summary, error from public.job_runs order by started_at desc limit 15) r), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(r) from (select day, route, name, message, occurrences, last_seen from public.app_error_events order by last_seen desc limit 20) r), '[]'::jsonb),
    'payments', jsonb_build_object(
      'pending_over_1h', (select count(*) from public.payments where status = 'pending' and created_at < now() - interval '1 hour' and created_at > now() - interval '2 days'),
      'failed_24h', (select count(*) from public.payments where status = 'failed' and created_at > now() - interval '24 hours'),
      'webhook_events_24h', coalesce((select jsonb_agg(r) from (select outcome, count(*) as events from public.payment_events where received_at > now() - interval '24 hours' group by 1 order by 2 desc) r), '[]'::jsonb),
      'subscription_events_24h', (select count(*) from public.ai_subscription_events where received_at > now() - interval '24 hours')),
    'ai', jsonb_build_object(
      'failed_24h', (select count(*) from public.ai_usage_events where created_at > now() - interval '24 hours' and status in ('failed', 'expired')),
      'stuck_reservations', (select count(*) from public.ai_usage_events where status = 'reserved' and expires_at < now())),
    'storage', jsonb_build_object(
      'pdf_bytes', (select coalesce(sum(file_size), 0) from public.pdf_documents), 'pdf_files', (select count(*) from public.pdf_documents),
      'budget_bytes', (select value_num from public.billing_settings where key = 'storage_budget_bytes')),
    'events', jsonb_build_object('events_total', (select count(*) from public.product_events), 'oldest', (select min(created_at) from public.product_events)),
    'audit', public.admin_audit_verify(p_actor));
end $$;

create or replace function public.admin_ack_alert(p_actor uuid, p_alert bigint, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor, true);
  update public.system_alerts set acknowledged_at = now(), acknowledged_by = p_actor where id = p_alert and acknowledged_at is null;
  perform public.admin_audit_write(p_actor, 'alert.acknowledge', 'alert', p_alert::text, null, '{}'::jsonb, p_ip);
  return jsonb_build_object('ok', true);
end $$;

-- Settings the owner may change from the console. Only these keys, only within bounds, always with a reason.
create or replace function public.admin_set_setting(p_actor uuid, p_scope text, p_key text, p_value numeric, p_reason text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_old numeric; v_ok boolean;
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if p_value is null or p_value < 0 then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  perform public.admin_rate_check(p_actor, 'setting.', 20);
  if p_scope = 'ai' then
    v_ok := p_key in ('platform_daily_budget_micro_usd', 'platform_monthly_budget_micro_usd', 'max_concurrent_ops_per_user', 'max_ops_per_minute_per_user');
    if not v_ok then raise exception 'setting_not_editable' using errcode = 'P0001'; end if;
    if p_key like 'platform_%' and p_value > 100000000000 then raise exception 'invalid_value' using errcode = 'P0001'; end if;
    select value_num into v_old from public.ai_settings where key = p_key;
    update public.ai_settings set value_num = p_value::bigint, updated_at = now() where key = p_key;
  elsif p_scope = 'billing' then
    v_ok := p_key in ('payment_fee_pct', 'payment_fee_fixed_usd', 'monthly_infrastructure_cost_usd', 'storage_budget_bytes', 'admin_grant_max_credits', 'admin_grant_daily_max_credits', 'admin_sensitive_ops_per_hour');
    if not v_ok then raise exception 'setting_not_editable' using errcode = 'P0001'; end if;
    if p_key = 'payment_fee_pct' and p_value > 30 then raise exception 'invalid_value' using errcode = 'P0001'; end if;
    select value_num into v_old from public.billing_settings where key = p_key;
    insert into public.billing_settings (key, value_num, description) values (p_key, p_value,
      case p_key when 'monthly_infrastructure_cost_usd' then 'Monthly hosting and infrastructure cost in USD, entered by the owner. Used only for contribution estimates.'
                 when 'storage_budget_bytes' then 'Storage budget in bytes, entered by the owner. Used only for the storage alert.' else p_key end)
    on conflict (key) do update set value_num = excluded.value_num, updated_at = now();
  else
    raise exception 'setting_not_editable' using errcode = 'P0001';
  end if;
  perform public.admin_audit_write(p_actor, 'setting.change', 'setting', p_scope || '.' || p_key, trim(p_reason), jsonb_build_object('old', v_old, 'new', p_value), p_ip);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_feature_limits(p_actor uuid, p_feature text, p_max_iterations int, p_max_tool_calls int, p_max_op_cost_usd numeric, p_enabled boolean, p_reason text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare old public.ai_features%rowtype;
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if p_max_iterations is null or p_max_iterations < 1 or p_max_iterations > 40 or p_max_tool_calls is null or p_max_tool_calls < 0 or p_max_tool_calls > 200
     or p_max_op_cost_usd is null or p_max_op_cost_usd <= 0 or p_max_op_cost_usd > 50 then raise exception 'invalid_value' using errcode = 'P0001'; end if;
  perform public.admin_rate_check(p_actor, 'setting.', 20);
  select * into old from public.ai_features where feature_key = p_feature for update;
  if not found then raise exception 'unknown_feature' using errcode = 'P0001'; end if;
  update public.ai_features set max_iterations = p_max_iterations, max_tool_calls = p_max_tool_calls, max_op_cost_micro_usd = round(p_max_op_cost_usd * 1000000)::bigint,
         enabled = coalesce(p_enabled, enabled), updated_at = now() where feature_key = p_feature;
  perform public.admin_audit_write(p_actor, 'setting.feature_limits', 'ai_feature', p_feature, trim(p_reason),
    jsonb_build_object('old', jsonb_build_object('iterations', old.max_iterations, 'tool_calls', old.max_tool_calls, 'op_cost_usd', old.max_op_cost_micro_usd / 1000000.0, 'enabled', old.enabled),
                       'new', jsonb_build_object('iterations', p_max_iterations, 'tool_calls', p_max_tool_calls, 'op_cost_usd', p_max_op_cost_usd, 'enabled', coalesce(p_enabled, old.enabled))), p_ip);
  return jsonb_build_object('ok', true);
end $$;

-- Month-to-date AI spend, for the application-level monthly budget guard.
create or replace function public.ai_platform_month_status(p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$ select jsonb_build_object(
  'budget_micro_usd', public.ai_setting('platform_monthly_budget_micro_usd'),
  'spent_micro_usd', coalesce((select sum(spent_micro_usd) from public.ai_platform_days where day >= date_trunc('month', p_now at time zone 'UTC')::date), 0)) $$;

create or replace function public.admin_payments_page(p_actor uuid, p_from timestamptz, p_to timestamptz, p_status text default null, p_limit int default 25, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor);
  return jsonb_build_object(
    'total', (select count(*) from public.payments where created_at >= p_from and created_at < p_to and (p_status is null or status = p_status)),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
      select p.id, p.created_at, p.fulfilled_at, p.refunded_at, u.email, p.provider, p.provider_transaction_id, p.tx_ref, p.kind, p.product_key, p.amount, p.currency, p.status, p.method, p.failure_reason
        from public.payments p left join auth.users u on u.id = p.user_id
       where p.created_at >= p_from and p.created_at < p_to and (p_status is null or p.status = p_status)
       order by p.created_at desc limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)) r), '[]'::jsonb));
end $$;

-- 10. Privileges ----------------------------------------------------------------------------------------------------------------
-- Nothing above is callable by the browser roles. Every function runs only with the server's service role key.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'admin\_%' or p.proname in ('analytics_prune', 'job_run_start', 'job_run_finish', 'app_error_record', 'system_alert_raise', 'ai_platform_month_status'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
