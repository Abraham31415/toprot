-- Phase 7: configurable plans, purchased credit packs, payments (Flutterwave), credit transactions, billing admin.
--
-- Extends the AI credit system (20261109120000_ai_usage_credits.sql). Design:
--   * Plans, prices, credit packs and billing settings are DATA (tables), edited with SQL. No price or quota is in code.
--   * Subscription credits stay the existing per-period allowance ("period"). Purchased credits are separate, expiring
--     LOTS. A charge always uses the period allowance first, then lots in order of expiry.
--   * A reservation holds credits from both pools atomically, under the same locks as before (platform day -> user period
--     -> that user's lots). Every movement of credits is also written to ai_credit_transactions.
--   * Money in: a payment row is created (pending) before checkout; only billing_fulfill_payment, called by the backend
--     AFTER it has verified the transaction with the payment provider, can activate a subscription or issue credits.
--   * Everything here is callable only by the service role. Users can read their own payments, lots and transactions.

-- 1. Settings, plans, prices, packs ----------------------------------------------------------------------------------

create table public.billing_settings (
  key text primary key,
  value_num numeric not null,
  description text not null,
  updated_at timestamptz not null default now()
);
insert into public.billing_settings (key, value_num, description) values
  ('renewal_window_days', 3, 'A subscription can be renewed during this many days before its period ends (or after it ends).'),
  ('payment_fee_pct', 3.8, 'ESTIMATED payment processing fee, percent of each payment, used only for margin estimates. Check your merchant agreement.'),
  ('payment_fee_fixed_usd', 0, 'ESTIMATED fixed fee per payment in USD, used only for margin estimates.'),
  ('max_pending_payments_per_hour', 10, 'Checkout attempts one user may start per hour.'),
  ('pending_payment_expiry_minutes', 120, 'A pending payment that is still unpaid after this long is closed by the reconciliation job.');

create table public.plans (
  plan_key text primary key check (plan_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null,
  tagline text not null default '',
  is_paid boolean not null,
  tier_rank int not null default 0,
  -- Paid plans: credits granted each billing period. Free plan: one-time introductory credits.
  monthly_credits int not null default 0 check (monthly_credits >= 0),
  intro_credits int not null default 0 check (intro_credits >= 0),
  -- null = unlimited
  max_projects int check (max_projects is null or max_projects >= 0),
  -- AI features (ai_features.feature_key) this plan may use.
  ai_features text[] not null default '{}',
  -- Marketing bullets shown on the pricing page. Plain text only.
  bullets text[] not null default '{}',
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  check (is_paid or monthly_credits = 0)
);

insert into public.plans (plan_key, name, tagline, is_paid, tier_rank, monthly_credits, intro_credits, max_projects, ai_features, bullets, sort) values
  ('free', 'Free', 'Everything you need to plan a study.', false, 0, 0,
   (select value_num::int from public.ai_settings where key = 'free_intro_credits'), 3,
   array['protocol_review', 'assistant_light', 'assistant_standard'],
   array['Free research calculators and basic research tools', 'Up to 3 projects', 'Reference manager, citation formatting and literature search',
         'A small one-time allowance of AI credits for basic assistant tasks'], 0),
  ('pro', 'Toprot Pro', 'More projects and the full AI research assistant.', true, 1,
   (select value_num::int from public.ai_settings where key = 'pro_period_credits'), 0, 25,
   array['protocol_review', 'assistant_light', 'assistant_standard', 'assistant_deep', 'pdf_qa', 'pdf_compare'],
   array['Up to 25 projects', 'Advanced AI writing and manuscript editing help', 'PDF research assistance: questions and paper comparison',
         'Literature synthesis and the advanced research agent', 'Monthly AI credits that reset each billing period'], 1);

create table public.billing_prices (
  kind text not null check (kind in ('plan', 'pack')),
  product_key text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Major units (7.99 means 7.99 dollars). Zero-decimal currencies such as UGX use whole numbers.
  amount numeric(14, 2) not null check (amount > 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (kind, product_key, currency)
);

create table public.credit_packs (
  pack_key text primary key check (pack_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null,
  credits int not null check (credits > 0),
  -- Purchased credits expire this many days after purchase. Shown to the buyer before they pay.
  expiry_days int not null check (expiry_days between 30 and 1825),
  active boolean not null default true,
  sort int not null default 0
);

insert into public.credit_packs (pack_key, name, credits, expiry_days, sort) values
  ('credits_2000', '2,000 credits', 2000, 365, 1),
  ('credits_5000', '5,000 credits', 5000, 365, 2),
  ('credits_10000', '10,000 credits', 10000, 365, 3);

-- PROPOSED prices, pending cost validation. UGX prices are intentionally not seeded: set them (with your own rounding)
-- before offering Ugandan Mobile Money, which requires UGX.
insert into public.billing_prices (kind, product_key, currency, amount) values
  ('plan', 'pro', 'USD', 7.99), ('pack', 'credits_2000', 'USD', 4.99), ('pack', 'credits_5000', 'USD', 9.99), ('pack', 'credits_10000', 'USD', 16.99);

-- Subscriptions now reference plans instead of a fixed pair of names.
alter table public.ai_subscriptions drop constraint if exists ai_subscriptions_plan_check;
alter table public.ai_subscriptions add constraint ai_subscriptions_plan_fk foreign key (plan) references public.plans (plan_key);
-- The old rule "pro + active needs a period" now applies to any paid plan; the application enforces it in fulfilment.

-- 2. Payments ------------------------------------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider text not null default 'flutterwave',
  tx_ref text not null unique check (length(tx_ref) between 16 and 100),
  provider_transaction_id text,
  kind text not null check (kind in ('subscription', 'pack')),
  product_key text not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  method text,
  failure_reason text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  fulfilled_at timestamptz,
  refunded_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);
create unique index payments_provider_txn_idx on public.payments (provider, provider_transaction_id) where provider_transaction_id is not null;
create index payments_user_idx on public.payments (user_id, created_at desc);
create index payments_status_idx on public.payments (status, created_at);

-- One row per provider notification. Lets duplicate and replayed webhooks be recognised and audited.
create table public.payment_events (
  provider text not null,
  event_key text not null,
  payment_id uuid references public.payments (id) on delete set null,
  outcome text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_key)
);

-- 3. Purchased credits (lots), allocations and the transaction ledger ----------------------------------------------

create table public.ai_credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('purchase', 'grant')),
  payment_id uuid unique references public.payments (id) on delete set null,
  credits_mcr bigint not null check (credits_mcr > 0),
  used_mcr bigint not null default 0 check (used_mcr >= 0 and used_mcr <= credits_mcr),
  reserved_mcr bigint not null default 0 check (reserved_mcr >= 0),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  expired_at timestamptz,
  note text
);
create index ai_credit_lots_user_idx on public.ai_credit_lots (user_id, expires_at) where expired_at is null;

create table public.ai_credit_allocations (
  event_id uuid not null references public.ai_usage_events (id) on delete cascade,
  lot_id uuid not null references public.ai_credit_lots (id) on delete cascade,
  reserved_mcr bigint not null check (reserved_mcr > 0),
  primary key (event_id, lot_id)
);

alter table public.ai_usage_events
  add column reserved_lot_mcr bigint not null default 0 check (reserved_lot_mcr >= 0),
  add column charged_lot_mcr bigint not null default 0 check (charged_lot_mcr >= 0);

create table public.ai_credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('subscription_grant', 'purchase', 'usage', 'expiry', 'refund', 'adjustment')),
  pool text not null check (pool in ('subscription', 'purchased')),
  -- Positive adds credits, negative uses or removes them. Milli-credits (1 credit = 1000).
  amount_mcr bigint not null,
  event_id uuid references public.ai_usage_events (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  lot_id uuid references public.ai_credit_lots (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index ai_credit_transactions_user_idx on public.ai_credit_transactions (user_id, created_at desc);

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 4. Plan resolution ---------------------------------------------------------------------------------------------------

create or replace function public.billing_user_plan(p_user uuid, p_now timestamptz default now())
returns text
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s public.ai_subscriptions%rowtype;
begin
  select * into s from public.ai_subscriptions where user_id = p_user;
  if found and s.status = 'active' and s.current_period_start <= p_now and p_now < s.current_period_end
     and exists (select 1 from public.plans where plan_key = s.plan and is_paid) then
    return s.plan;
  end if;
  return 'free';
end $$;

create or replace function public.ai_plan_allows(p_user uuid, p_feature text)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.plans p where p.plan_key = public.billing_user_plan(p_user) and p_feature = any (p.ai_features))
$$;

-- Allowances now come from the plans table (falling back to the older settings if a plan row is missing).
create or replace function public.ai_entitlement(
  p_user uuid, p_now timestamptz default now(),
  out o_kind text, out o_period_start timestamptz, out o_period_end timestamptz, out o_allowance_mcr bigint
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s public.ai_subscriptions%rowtype; pl public.plans%rowtype; v_plan text;
begin
  v_plan := public.billing_user_plan(p_user, p_now);
  if v_plan <> 'free' then
    select * into s from public.ai_subscriptions where user_id = p_user;
    select * into pl from public.plans where plan_key = v_plan;
    o_kind := 'pro';
    o_period_start := s.current_period_start;
    o_period_end := s.current_period_end;
    o_allowance_mcr := coalesce(pl.monthly_credits, public.ai_setting('pro_period_credits')) * 1000;
  else
    select * into pl from public.plans where plan_key = 'free';
    o_kind := 'intro';
    o_period_start := '1970-01-01 00:00:00+00'::timestamptz;
    o_period_end := null;
    o_allowance_mcr := coalesce(pl.intro_credits, public.ai_setting('free_intro_credits')) * 1000;
  end if;
end $$;

create or replace function public.ai_apply_subscription_event(
  p_provider text, p_event_id text, p_event_time timestamptz, p_user uuid,
  p_plan text, p_status text, p_period_start timestamptz, p_period_end timestamptz,
  p_provider_subscription_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_rows int; v_existing public.ai_subscriptions%rowtype;
begin
  if not exists (select 1 from public.plans where plan_key = p_plan) or p_status not in ('active', 'past_due', 'canceled', 'expired') then
    return jsonb_build_object('applied', false, 'reason', 'invalid');
  end if;
  if p_plan <> 'free' and p_status = 'active'
     and (p_period_start is null or p_period_end is null or p_period_end <= p_period_start) then
    return jsonb_build_object('applied', false, 'reason', 'invalid_period');
  end if;
  insert into public.ai_subscription_events (provider, event_id, user_id, event_time, plan, status)
  values (p_provider, p_event_id, p_user, p_event_time, p_plan, p_status) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('applied', false, 'reason', 'duplicate'); end if;
  select * into v_existing from public.ai_subscriptions where user_id = p_user for update;
  if found and v_existing.last_event_at > p_event_time then return jsonb_build_object('applied', false, 'reason', 'stale'); end if;
  insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, provider_subscription_id, last_event_at, updated_at)
  values (p_user, p_plan, p_status, p_period_start, p_period_end, p_provider, p_provider_subscription_id, p_event_time, now())
  on conflict (user_id) do update set plan = excluded.plan, status = excluded.status, current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end, provider = excluded.provider, provider_subscription_id = excluded.provider_subscription_id,
    last_event_at = excluded.last_event_at, updated_at = now();
  return jsonb_build_object('applied', true);
end $$;

-- 5. Expiry of purchased credits -------------------------------------------------------------------------------------

create or replace function public.billing_expire_lots_for(p_user uuid, p_now timestamptz default now())
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare l record; n int := 0;
begin
  for l in select id, credits_mcr - used_mcr as remaining from public.ai_credit_lots
            where user_id = p_user and expired_at is null and expires_at <= p_now order by expires_at, id for update
  loop
    if l.remaining > 0 then
      insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, lot_id, note)
      values (p_user, 'expiry', 'purchased', -l.remaining, l.id, 'Purchased credits expired');
    end if;
    update public.ai_credit_lots set expired_at = p_now where id = l.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- For the scheduled job: expires lots for every user (bounded per run).
create or replace function public.billing_sweep_expired_lots(p_now timestamptz default now())
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare u record; n int := 0;
begin
  for u in select distinct user_id from public.ai_credit_lots where expired_at is null and expires_at <= p_now limit 500 loop
    n := n + public.billing_expire_lots_for(u.user_id, p_now);
  end loop;
  return n;
end $$;

-- 6. Reservations across both pools -----------------------------------------------------------------------------------

-- Frees what a reservation holds: its share of the period and of any lots. Callers hold the platform-day and period locks.
create or replace function public.ai_free_reservation(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare ev public.ai_usage_events%rowtype; a record;
begin
  select * into ev from public.ai_usage_events where id = p_event_id;
  if not found then return; end if;
  update public.ai_credit_periods set reserved_mcr = greatest(reserved_mcr - (ev.reserved_mcr - ev.reserved_lot_mcr), 0) where id = ev.period_id;
  for a in select lot_id, reserved_mcr from public.ai_credit_allocations where event_id = p_event_id order by lot_id loop
    update public.ai_credit_lots set reserved_mcr = greatest(reserved_mcr - a.reserved_mcr, 0) where id = a.lot_id;
  end loop;
  delete from public.ai_credit_allocations where event_id = p_event_id;
end $$;

create or replace function public.ai_sweep_expired(p_now timestamptz default now())
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; ev public.ai_usage_events%rowtype; n int := 0;
begin
  if not pg_try_advisory_xact_lock(727401) then return 0; end if;
  for r in
    select id, period_id, platform_day from public.ai_usage_events
    where status = 'reserved' and expires_at < p_now order by platform_day, period_id, id limit 200
  loop
    perform 1 from public.ai_platform_days where day = r.platform_day for update;
    perform 1 from public.ai_credit_periods where id = r.period_id for update;
    select * into ev from public.ai_usage_events where id = r.id for update;
    if ev.status <> 'reserved' or ev.expires_at >= p_now then continue; end if;
    update public.ai_usage_events set status = 'expired', finished_at = p_now where id = ev.id;
    perform public.ai_free_reservation(ev.id);
    update public.ai_platform_days
       set reserved_micro_usd = greatest(reserved_micro_usd - ev.reserved_micro_usd, 0), updated_at = now()
     where day = ev.platform_day;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.ai_reserve(
  p_user uuid, p_key text, p_feature text, p_model text,
  p_reserve_micro_usd bigint, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_day date := public.ai_utc_day(now());
  v_budget bigint;
  v_feat public.ai_features%rowtype;
  v_price public.ai_model_pricing%rowtype;
  v_day_row public.ai_platform_days%rowtype;
  v_kind text; v_pstart timestamptz; v_pend timestamptz; v_allow bigint;
  v_period public.ai_credit_periods%rowtype;
  v_existing public.ai_usage_events%rowtype;
  v_reserve_mcr bigint; v_available bigint; v_lots_avail bigint; v_lot_part bigint; v_left bigint;
  v_remaining bigint; v_count int; v_event uuid; l record; v_take bigint;
begin
  if p_key is null or length(p_key) < 8 or length(p_key) > 128
     or p_reserve_micro_usd is null or p_reserve_micro_usd <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into v_feat from public.ai_features where feature_key = p_feature;
  if not found or not v_feat.enabled then
    return jsonb_build_object('ok', false, 'code', 'feature_disabled');
  end if;

  -- The plan decides which AI features a user may use. Neither the browser nor the model can change this.
  if not public.ai_plan_allows(p_user, p_feature) then
    return jsonb_build_object('ok', false, 'code', 'plan_required', 'plan', public.billing_user_plan(p_user));
  end if;

  select * into v_price from public.ai_model_pricing where model_id = p_model and active;
  if not found or not (p_model = any (v_feat.model_chain)) then
    return jsonb_build_object('ok', false, 'code', 'unknown_model');
  end if;

  if p_reserve_micro_usd > v_feat.max_op_cost_micro_usd then
    return jsonb_build_object('ok', false, 'code', 'op_cost_too_high', 'max_op_cost_micro_usd', v_feat.max_op_cost_micro_usd);
  end if;

  -- Lock order: platform day -> (sweep) -> user period -> that user's lots.
  v_budget := public.ai_setting('platform_daily_budget_micro_usd');
  insert into public.ai_platform_days (day, budget_micro_usd) values (v_day, v_budget) on conflict (day) do nothing;
  perform 1 from public.ai_platform_days where day = v_day for update;
  update public.ai_platform_days set budget_micro_usd = v_budget where day = v_day and budget_micro_usd <> v_budget;

  perform public.ai_sweep_expired(now());
  select * into v_day_row from public.ai_platform_days where day = v_day;

  select o_kind, o_period_start, o_period_end, o_allowance_mcr
    into v_kind, v_pstart, v_pend, v_allow from public.ai_entitlement(p_user, now());
  insert into public.ai_credit_periods (user_id, kind, period_start, period_end, allowance_mcr)
  values (p_user, v_kind, v_pstart, v_pend, v_allow) on conflict (user_id, kind, period_start) do nothing;
  select * into v_period from public.ai_credit_periods
   where user_id = p_user and kind = v_kind and period_start = v_pstart for update;

  select * into v_existing from public.ai_usage_events where user_id = p_user and idempotency_key = p_key;
  if found then
    return jsonb_build_object('ok', false, 'event_id', v_existing.id, 'status', v_existing.status,
      'code', case v_existing.status when 'committed' then 'duplicate_completed' when 'reserved' then 'duplicate_in_flight' else 'duplicate_failed' end);
  end if;

  select count(*) into v_count from public.ai_usage_events where user_id = p_user and status = 'reserved';
  if v_count >= public.ai_setting('max_concurrent_ops_per_user') then
    return jsonb_build_object('ok', false, 'code', 'too_many_concurrent');
  end if;
  select count(*) into v_count from public.ai_usage_events where user_id = p_user and created_at > now() - interval '60 seconds';
  if v_count >= public.ai_setting('max_ops_per_minute_per_user') then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  perform public.billing_expire_lots_for(p_user, now());
  v_reserve_mcr := public.ai_micro_to_mcr(p_reserve_micro_usd);
  v_available := greatest(v_period.allowance_mcr - v_period.used_mcr - v_period.reserved_mcr, 0);
  select coalesce(sum(credits_mcr - used_mcr - reserved_mcr), 0) into v_lots_avail
    from public.ai_credit_lots where user_id = p_user and expired_at is null and expires_at > now();
  v_lots_avail := greatest(v_lots_avail, 0);
  if v_reserve_mcr > v_available + v_lots_avail then
    return jsonb_build_object('ok', false, 'code', 'insufficient_credits', 'plan', v_kind,
                              'available_mcr', v_available + v_lots_avail, 'required_mcr', v_reserve_mcr);
  end if;

  v_remaining := greatest(v_day_row.budget_micro_usd - v_day_row.spent_micro_usd - v_day_row.reserved_micro_usd, 0);
  if p_reserve_micro_usd > v_remaining then
    return jsonb_build_object('ok', false, 'code', 'platform_budget_exceeded', 'platform_remaining_micro_usd', v_remaining);
  end if;

  -- Subscription credits first; only what they cannot cover is held from purchased lots.
  v_lot_part := greatest(v_reserve_mcr - v_available, 0);

  insert into public.ai_usage_events
    (user_id, period_id, idempotency_key, feature_key, model_id, status,
     reserved_mcr, reserved_lot_mcr, reserved_micro_usd, platform_day, expires_at, meta)
  values
    (p_user, v_period.id, p_key, p_feature, p_model, 'reserved',
     v_reserve_mcr, v_lot_part, p_reserve_micro_usd, v_day,
     now() + make_interval(secs => public.ai_setting('reservation_lease_seconds')::double precision),
     coalesce(p_meta, '{}'::jsonb))
  returning id into v_event;

  update public.ai_credit_periods set reserved_mcr = reserved_mcr + (v_reserve_mcr - v_lot_part) where id = v_period.id;

  v_left := v_lot_part;
  if v_left > 0 then
    for l in select id, credits_mcr - used_mcr - reserved_mcr as free from public.ai_credit_lots
              where user_id = p_user and expired_at is null and expires_at > now() and credits_mcr - used_mcr - reserved_mcr > 0
              order by expires_at, id for update
    loop
      v_take := least(l.free, v_left);
      insert into public.ai_credit_allocations (event_id, lot_id, reserved_mcr) values (v_event, l.id, v_take);
      update public.ai_credit_lots set reserved_mcr = reserved_mcr + v_take where id = l.id;
      v_left := v_left - v_take;
      exit when v_left = 0;
    end loop;
  end if;

  update public.ai_platform_days
     set reserved_micro_usd = reserved_micro_usd + p_reserve_micro_usd, updated_at = now() where day = v_day;

  return jsonb_build_object('ok', true, 'code', 'ok', 'event_id', v_event, 'period_id', v_period.id,
                            'plan', v_kind, 'reserved_mcr', v_reserve_mcr,
                            'available_mcr', v_available + v_lots_avail - v_reserve_mcr);
end $$;

create or replace function public.ai_commit(
  p_event uuid, p_input bigint, p_output bigint,
  p_cache_read bigint default 0, p_cache_write_5m bigint default 0, p_cache_write_1h bigint default 0,
  p_tool_usage jsonb default '{}'::jsonb, p_iterations int default 1,
  p_error_code text default null, p_platform_exposure_micro_usd bigint default 0,
  p_usage_known boolean default true
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_probe record;
  v_ev public.ai_usage_events%rowtype;
  v_period public.ai_credit_periods%rowtype;
  v_cost bigint; v_tool_cost bigint; v_unpriced text[]; v_tool_calls int;
  v_charged bigint; v_overrun bigint; v_was_reserved boolean;
  v_from_period bigint; v_from_lots bigint := 0; v_left bigint; v_take bigint; l record;
begin
  if least(p_input, p_output, p_cache_read, p_cache_write_5m, p_cache_write_1h, coalesce(p_platform_exposure_micro_usd, 0)) < 0
     or coalesce(p_iterations, 1) < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_usage');
  end if;

  select user_id, period_id, platform_day into v_probe from public.ai_usage_events where id = p_event;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  perform 1 from public.ai_platform_days where day = v_probe.platform_day for update;
  select * into v_period from public.ai_credit_periods where id = v_probe.period_id for update;
  select * into v_ev from public.ai_usage_events where id = p_event for update;

  if v_ev.status = 'committed' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'charged_mcr', v_ev.charged_mcr, 'cost_micro_usd', v_ev.cost_micro_usd);
  end if;
  if v_ev.status in ('released', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'already_finalized', 'status', v_ev.status);
  end if;

  v_was_reserved := v_ev.status = 'reserved';
  v_cost := public.ai_cost_micro_usd(v_ev.model_id, p_input, p_output, p_cache_read, p_cache_write_5m, p_cache_write_1h);
  select o_cost, o_unpriced, o_calls into v_tool_cost, v_unpriced, v_tool_calls from public.ai_tool_cost(p_tool_usage);
  v_cost := v_cost + v_tool_cost;
  v_charged := public.ai_micro_to_mcr(v_cost);
  v_overrun := greatest(v_charged - v_ev.reserved_mcr, 0);

  if v_was_reserved then perform public.ai_free_reservation(v_ev.id); end if;
  select * into v_period from public.ai_credit_periods where id = v_probe.period_id;

  -- Charge the actual cost: subscription credits first, then purchased lots by earliest expiry. Whatever neither can
  -- cover is recorded as an overrun on the period (as before), so usage is never lost.
  v_from_period := least(v_charged, greatest(v_period.allowance_mcr - v_period.used_mcr, 0));
  v_left := v_charged - v_from_period;
  if v_left > 0 then
    for l in select id, credits_mcr - used_mcr as rem from public.ai_credit_lots
              where user_id = v_ev.user_id and expired_at is null and expires_at > now() and credits_mcr - used_mcr > 0
              order by expires_at, id for update
    loop
      v_take := least(l.rem, v_left);
      update public.ai_credit_lots set used_mcr = used_mcr + v_take where id = l.id;
      insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, event_id, lot_id, note)
      values (v_ev.user_id, 'usage', 'purchased', -v_take, v_ev.id, l.id, v_ev.feature_key);
      v_from_lots := v_from_lots + v_take;
      v_left := v_left - v_take;
      exit when v_left = 0;
    end loop;
  end if;
  if v_from_period + v_left > 0 then
    insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, event_id, note)
    values (v_ev.user_id, 'usage', 'subscription', -(v_from_period + v_left), v_ev.id, v_ev.feature_key);
  end if;

  update public.ai_usage_events set
    status = 'committed', charged_mcr = v_charged, charged_lot_mcr = v_from_lots, cost_micro_usd = v_cost,
    input_tokens = p_input, output_tokens = p_output, cache_read_tokens = p_cache_read,
    cache_write_5m_tokens = p_cache_write_5m, cache_write_1h_tokens = p_cache_write_1h,
    tool_calls = v_tool_calls, tool_usage = coalesce(p_tool_usage, '{}'::jsonb), unpriced_tools = v_unpriced,
    iterations = coalesce(p_iterations, 1), usage_known = p_usage_known, overrun_mcr = v_overrun,
    platform_exposure_micro_usd = coalesce(p_platform_exposure_micro_usd, 0),
    error_code = p_error_code, finished_at = now()
  where id = v_ev.id;

  update public.ai_credit_periods set used_mcr = used_mcr + v_from_period + v_left where id = v_ev.period_id;

  update public.ai_platform_days set
    reserved_micro_usd = case when v_was_reserved then greatest(reserved_micro_usd - v_ev.reserved_micro_usd, 0) else reserved_micro_usd end,
    spent_micro_usd = spent_micro_usd + v_cost + coalesce(p_platform_exposure_micro_usd, 0), updated_at = now()
  where day = v_ev.platform_day;

  perform public.ai_check_alerts(v_ev.platform_day);

  return jsonb_build_object('ok', true, 'duplicate', false, 'charged_mcr', v_charged, 'cost_micro_usd', v_cost,
                            'overrun_mcr', v_overrun, 'unpriced_tools', to_jsonb(v_unpriced));
end $$;

create or replace function public.ai_release(
  p_event uuid, p_error_code text default null,
  p_platform_exposure_micro_usd bigint default 0, p_usage_known boolean default true
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_probe record; v_ev public.ai_usage_events%rowtype; v_was_reserved boolean; v_exposure bigint;
begin
  v_exposure := coalesce(p_platform_exposure_micro_usd, 0);
  if v_exposure < 0 then return jsonb_build_object('ok', false, 'code', 'invalid_usage'); end if;

  select user_id, period_id, platform_day into v_probe from public.ai_usage_events where id = p_event;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  perform 1 from public.ai_platform_days where day = v_probe.platform_day for update;
  perform 1 from public.ai_credit_periods where id = v_probe.period_id for update;
  select * into v_ev from public.ai_usage_events where id = p_event for update;

  if v_ev.status in ('committed', 'released', 'failed') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'status', v_ev.status);
  end if;
  v_was_reserved := v_ev.status = 'reserved';

  update public.ai_usage_events set
    status = case when p_error_code is null then 'released' else 'failed' end,
    error_code = p_error_code, usage_known = p_usage_known, platform_exposure_micro_usd = v_exposure, finished_at = now()
  where id = v_ev.id;

  if v_was_reserved then perform public.ai_free_reservation(v_ev.id); end if;

  update public.ai_platform_days set
    reserved_micro_usd = case when v_was_reserved then greatest(reserved_micro_usd - v_ev.reserved_micro_usd, 0) else reserved_micro_usd end,
    spent_micro_usd = spent_micro_usd + v_exposure, updated_at = now()
  where day = v_ev.platform_day;

  if v_exposure > 0 then perform public.ai_check_alerts(v_ev.platform_day); end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', case when p_error_code is null then 'released' else 'failed' end);
end $$;

create or replace function public.ai_get_headroom(p_user uuid, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_kind text; v_pstart timestamptz; v_pend timestamptz; v_allow bigint;
  v_period public.ai_credit_periods%rowtype;
  v_day_row public.ai_platform_days%rowtype;
  v_used bigint := 0; v_reserved bigint := 0; v_stale bigint := 0;
  v_p_spent bigint := 0; v_p_reserved bigint := 0; v_p_stale bigint := 0;
  v_budget bigint; v_period_id uuid; v_sub_avail bigint; v_lots bigint; v_lots_next timestamptz;
begin
  select o_kind, o_period_start, o_period_end, o_allowance_mcr
    into v_kind, v_pstart, v_pend, v_allow from public.ai_entitlement(p_user, p_now);

  select * into v_period from public.ai_credit_periods where user_id = p_user and kind = v_kind and period_start = v_pstart;
  if found then
    v_period_id := v_period.id;
    v_allow := v_period.allowance_mcr; v_used := v_period.used_mcr; v_reserved := v_period.reserved_mcr;
    select coalesce(sum(reserved_mcr - reserved_lot_mcr), 0) into v_stale from public.ai_usage_events
     where period_id = v_period.id and status = 'reserved' and expires_at < p_now;
  end if;
  v_sub_avail := greatest(v_allow - v_used - greatest(v_reserved - v_stale, 0), 0);

  select coalesce(sum(greatest(credits_mcr - used_mcr - reserved_mcr, 0)), 0),
         min(expires_at) filter (where credits_mcr - used_mcr > 0)
    into v_lots, v_lots_next
    from public.ai_credit_lots where user_id = p_user and expired_at is null and expires_at > p_now;

  v_budget := public.ai_setting('platform_daily_budget_micro_usd');
  select * into v_day_row from public.ai_platform_days where day = public.ai_utc_day(p_now);
  if found then
    v_p_spent := v_day_row.spent_micro_usd; v_p_reserved := v_day_row.reserved_micro_usd;
    select coalesce(sum(reserved_micro_usd), 0) into v_p_stale from public.ai_usage_events
     where platform_day = v_day_row.day and status = 'reserved' and expires_at < p_now;
  end if;

  return jsonb_build_object(
    'plan', v_kind, 'plan_key', public.billing_user_plan(p_user, p_now), 'period_id', v_period_id,
    'period_start', case when v_kind = 'pro' then v_pstart else null end, 'period_end', v_pend,
    'allowance_mcr', v_allow, 'used_mcr', v_used,
    'reserved_mcr', greatest(v_reserved - v_stale, 0),
    'subscription_available_mcr', v_sub_avail,
    'purchased_available_mcr', v_lots,
    'purchased_next_expiry', v_lots_next,
    'available_mcr', v_sub_avail + v_lots,
    'platform_remaining_micro_usd', greatest(v_budget - v_p_spent - greatest(v_p_reserved - v_p_stale, 0), 0),
    'credit_value_micro_usd', public.ai_setting('credit_value_micro_usd'));
end $$;

-- 7. Payments: create, fulfil, refund -------------------------------------------------------------------------------------

create or replace function public.billing_create_payment(p_user uuid, p_kind text, p_product text, p_currency text, p_tx_ref text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_price public.billing_prices%rowtype; s public.ai_subscriptions%rowtype; v_window int; v_pending int; v_id uuid;
begin
  if p_kind not in ('subscription', 'pack') or p_tx_ref is null or length(p_tx_ref) < 16 or p_currency !~ '^[A-Z]{3}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  if p_kind = 'subscription' then
    if not exists (select 1 from public.plans where plan_key = p_product and is_paid and active) then
      return jsonb_build_object('ok', false, 'code', 'unknown_product');
    end if;
    select * into v_price from public.billing_prices where kind = 'plan' and product_key = p_product and currency = p_currency and active;
  else
    if not exists (select 1 from public.credit_packs where pack_key = p_product and active) then
      return jsonb_build_object('ok', false, 'code', 'unknown_product');
    end if;
    select * into v_price from public.billing_prices where kind = 'pack' and product_key = p_product and currency = p_currency and active;
  end if;
  if not found then return jsonb_build_object('ok', false, 'code', 'currency_unavailable'); end if;

  if p_kind = 'subscription' then
    v_window := public.billing_setting_num('renewal_window_days')::int;
    select * into s from public.ai_subscriptions where user_id = p_user;
    if found and s.plan = p_product and s.status = 'active' and s.current_period_end > now() + make_interval(days => v_window) then
      return jsonb_build_object('ok', false, 'code', 'too_early', 'renew_from', s.current_period_end - make_interval(days => v_window));
    end if;
  end if;

  select count(*) into v_pending from public.payments where user_id = p_user and created_at > now() - interval '1 hour';
  if v_pending >= public.billing_setting_num('max_pending_payments_per_hour') then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts');
  end if;

  insert into public.payments (user_id, tx_ref, kind, product_key, amount, currency)
  values (p_user, p_tx_ref, p_kind, p_product, v_price.amount, p_currency) returning id into v_id;
  return jsonb_build_object('ok', true, 'payment_id', v_id, 'amount', v_price.amount, 'currency', p_currency, 'tx_ref', p_tx_ref);
end $$;

create or replace function public.billing_setting_num(p_key text)
returns numeric
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v numeric;
begin
  select value_num into v from public.billing_settings where key = p_key;
  if v is null then raise exception 'billing_setting % is missing', p_key using errcode = 'P0002'; end if;
  return v;
end $$;

-- Called ONLY after the backend has verified the transaction with the provider. The provider's reported amount and
-- currency must still match what the payment row expects. Safe to call repeatedly: a payment is fulfilled once.
create or replace function public.billing_fulfill_payment(
  p_tx_ref text, p_provider_txn text, p_provider_status text, p_amount numeric, p_currency text,
  p_method text default null, p_event_key text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  pay public.payments%rowtype; sub public.ai_subscriptions%rowtype; pl public.plans%rowtype; pk public.credit_packs%rowtype;
  v_base timestamptz; v_end timestamptz; v_lot uuid; v_dup boolean := false;
begin
  select * into pay from public.payments where tx_ref = p_tx_ref for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown_reference'); end if;

  if p_event_key is not null then
    insert into public.payment_events (provider, event_key, payment_id, outcome) values (pay.provider, p_event_key, pay.id, 'received')
    on conflict do nothing;
    get diagnostics v_dup = row_count;
    v_dup := not v_dup;
  end if;

  if pay.status = 'succeeded' then return jsonb_build_object('ok', true, 'duplicate', true, 'status', 'succeeded'); end if;
  if pay.status = 'refunded' then return jsonb_build_object('ok', false, 'code', 'refunded'); end if;
  if pay.user_id is null then return jsonb_build_object('ok', false, 'code', 'no_user'); end if;

  if p_provider_status is distinct from 'successful' then
    update public.payments set status = 'failed', failure_reason = left(coalesce(p_provider_status, 'unknown'), 100),
           provider_transaction_id = coalesce(provider_transaction_id, p_provider_txn)
     where id = pay.id and status = 'pending';
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  if p_currency is distinct from pay.currency or p_amount is null or p_amount < pay.amount then
    update public.payments set status = 'failed', failure_reason = 'amount_or_currency_mismatch' where id = pay.id;
    return jsonb_build_object('ok', false, 'code', 'mismatch');
  end if;

  if p_provider_txn is null or length(p_provider_txn) = 0 then return jsonb_build_object('ok', false, 'code', 'missing_transaction'); end if;
  if exists (select 1 from public.payments where provider = pay.provider and provider_transaction_id = p_provider_txn and id <> pay.id) then
    return jsonb_build_object('ok', false, 'code', 'transaction_already_used');
  end if;

  if pay.kind = 'subscription' then
    select * into pl from public.plans where plan_key = pay.product_key and is_paid;
    if not found then return jsonb_build_object('ok', false, 'code', 'unknown_product'); end if;
    select * into sub from public.ai_subscriptions where user_id = pay.user_id for update;
    -- Renewing inside the paid period extends it; a lapsed subscription starts now. Credits reset when the new period starts.
    v_base := case when found and sub.status = 'active' and sub.current_period_end > now() then sub.current_period_end else now() end;
    v_end := v_base + interval '1 month';
    insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, last_event_at, updated_at)
    values (pay.user_id, pl.plan_key, 'active', now(), v_end, pay.provider, now(), now())
    on conflict (user_id) do update set plan = excluded.plan, status = 'active', current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end, provider = excluded.provider, last_event_at = now(), updated_at = now();
    insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, payment_id, note)
    values (pay.user_id, 'subscription_grant', 'subscription', pl.monthly_credits::bigint * 1000, pay.id, pl.name || ' billing period');
  else
    select * into pk from public.credit_packs where pack_key = pay.product_key;
    if not found then return jsonb_build_object('ok', false, 'code', 'unknown_product'); end if;
    insert into public.ai_credit_lots (user_id, source, payment_id, credits_mcr, expires_at, note)
    values (pay.user_id, 'purchase', pay.id, pk.credits::bigint * 1000, now() + make_interval(days => pk.expiry_days), pk.name)
    returning id into v_lot;
    insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, payment_id, lot_id, note)
    values (pay.user_id, 'purchase', 'purchased', pk.credits::bigint * 1000, pay.id, v_lot, pk.name);
  end if;

  update public.payments set status = 'succeeded', provider_transaction_id = p_provider_txn, method = p_method,
         failure_reason = null, verified_at = now(), fulfilled_at = now() where id = pay.id;
  if p_event_key is not null then update public.payment_events set outcome = 'fulfilled', payment_id = pay.id where provider = pay.provider and event_key = p_event_key; end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'status', 'succeeded', 'kind', pay.kind);
end $$;

-- Closes checkouts that were never paid. Returns the tx_refs of recent pending payments the backend should re-check
-- with the provider first (the customer may have paid and the webhook been missed).
create or replace function public.billing_pending_to_check(p_older_than_minutes int default 10, p_limit int default 50)
returns table (tx_ref text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.tx_ref, p.created_at from public.payments p
   where p.status = 'pending' and p.created_at < now() - make_interval(mins => p_older_than_minutes)
   order by p.created_at limit p_limit
$$;

create or replace function public.billing_close_stale_payments()
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.payments set status = 'failed', failure_reason = 'checkout_not_completed'
   where status = 'pending' and created_at < now() - make_interval(mins => public.billing_setting_num('pending_payment_expiry_minutes')::int);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.billing_refund_payment(p_payment uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pay public.payments%rowtype; lot public.ai_credit_lots%rowtype;
begin
  select * into pay from public.payments where id = p_payment for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if pay.status <> 'succeeded' then return jsonb_build_object('ok', false, 'code', 'not_succeeded'); end if;
  if pay.kind = 'pack' then
    select * into lot from public.ai_credit_lots where payment_id = pay.id for update;
    if found and lot.expired_at is null and lot.credits_mcr - lot.used_mcr > 0 then
      insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, payment_id, lot_id, note)
      values (lot.user_id, 'refund', 'purchased', -(lot.credits_mcr - lot.used_mcr), pay.id, lot.id, left(p_reason, 200));
      update public.ai_credit_lots set expired_at = now(), used_mcr = credits_mcr where id = lot.id;
    end if;
  else
    update public.ai_subscriptions set status = 'canceled', current_period_end = least(current_period_end, now()), updated_at = now() where user_id = pay.user_id;
  end if;
  update public.payments set status = 'refunded', refunded_at = now(), failure_reason = left(p_reason, 200) where id = pay.id;
  return jsonb_build_object('ok', true);
end $$;

-- 8. Admin reporting ---------------------------------------------------------------------------------------------------------

create or replace function public.is_app_admin(p_user uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.app_admins where user_id = p_user) $$;

create or replace function public.billing_mask_email(p_email text)
returns text
language sql immutable
as $$ select case when p_email is null or position('@' in p_email) = 0 then 'unknown' else left(p_email, 1) || '***@' || split_part(p_email, '@', 2) end $$;

create or replace function public.billing_admin_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_fee_pct numeric := public.billing_setting_num('payment_fee_pct');
  v_fee_fixed numeric := public.billing_setting_num('payment_fee_fixed_usd');
  v_result jsonb; v_usd_rev numeric; v_usd_n int; v_cost numeric;
begin
  select coalesce(sum(amount), 0), count(*) into v_usd_rev, v_usd_n from public.payments
   where status = 'succeeded' and currency = 'USD' and fulfilled_at >= p_from and fulfilled_at < p_to;
  select coalesce(sum(cost_micro_usd + platform_exposure_micro_usd), 0) / 1000000.0 into v_cost from public.ai_usage_events
   where created_at >= p_from and created_at < p_to and status in ('committed', 'released', 'failed', 'expired');

  v_result := jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'new', (select count(*) from auth.users where created_at >= p_from and created_at < p_to),
      'ai_active', (select count(distinct user_id) from public.ai_usage_events where created_at >= p_from and created_at < p_to)),
    'paying_subscribers', (select count(*) from public.ai_subscriptions s join public.plans pl on pl.plan_key = s.plan
                            where pl.is_paid and s.status = 'active' and s.current_period_end > now()),
    'revenue', coalesce((select jsonb_agg(r) from (
        select currency, kind,
               sum(amount) as amount, count(*) as payments
          from public.payments where status = 'succeeded' and fulfilled_at >= p_from and fulfilled_at < p_to
         group by currency, kind order by currency, kind) r), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(r) from (
        select currency, sum(amount) as amount, count(*) as payments from public.payments
         where status = 'refunded' and refunded_at >= p_from and refunded_at < p_to group by currency) r), '[]'::jsonb),
    'ai_cost_usd', round(v_cost, 4),
    'cost_by_model', coalesce((select jsonb_agg(r) from (
        select model_id, count(*) as operations, sum(cost_micro_usd + platform_exposure_micro_usd) / 1000000.0 as cost_usd,
               sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
          from public.ai_usage_events where created_at >= p_from and created_at < p_to and status in ('committed', 'released', 'failed', 'expired')
         group by model_id order by 3 desc) r), '[]'::jsonb),
    'usage_by_feature', coalesce((select jsonb_agg(r) from (
        select feature_key, count(*) as operations, count(*) filter (where status = 'committed') as completed,
               sum(cost_micro_usd) / 1000000.0 as cost_usd, sum(charged_mcr) / 1000.0 as credits_charged
          from public.ai_usage_events where created_at >= p_from and created_at < p_to
         group by feature_key order by 3 desc) r), '[]'::jsonb),
    'margin', jsonb_build_object(
      'usd_revenue', v_usd_rev,
      'estimated_fees_usd', round(v_usd_rev * v_fee_pct / 100 + v_usd_n * v_fee_fixed, 2),
      'ai_cost_usd', round(v_cost, 4),
      'estimated_gross_margin_usd', round(v_usd_rev - (v_usd_rev * v_fee_pct / 100 + v_usd_n * v_fee_fixed) - v_cost, 2),
      'note', 'USD payments only. Other currencies are not converted. Fees are an estimate set in billing_settings.'),
    'payment_failures', jsonb_build_object(
      'count', (select count(*) from public.payments where status = 'failed' and created_at >= p_from and created_at < p_to),
      'by_reason', coalesce((select jsonb_agg(r) from (
          select coalesce(failure_reason, 'unknown') as reason, count(*) as payments from public.payments
           where status = 'failed' and created_at >= p_from and created_at < p_to group by 1 order by 2 desc limit 10) r), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(r) from (
          select p.created_at, p.kind, p.product_key, p.currency, p.amount, p.failure_reason,
                 public.billing_mask_email(u.email) as user_masked
            from public.payments p left join auth.users u on u.id = p.user_id
           where p.status = 'failed' and p.created_at >= p_from and p.created_at < p_to order by p.created_at desc limit 20) r), '[]'::jsonb)),
    'pending_payments', (select count(*) from public.payments where status = 'pending')
  );
  return v_result;
end $$;

-- Users whose recent AI usage stands out. Heuristics for a human to review, not accusations.
create or replace function public.billing_admin_unusual_usage(p_since timestamptz default now() - interval '7 days')
returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  with per_user as (
    select e.user_id, count(*) as operations,
           count(*) filter (where e.status in ('failed', 'expired')) as failures,
           sum(e.cost_micro_usd + e.platform_exposure_micro_usd) / 1000000.0 as cost_usd,
           sum(e.cost_micro_usd) filter (where e.created_at > now() - interval '24 hours') / 1000000.0 as cost_24h
      from public.ai_usage_events e where e.created_at >= p_since group by e.user_id
  ), med as (select coalesce(percentile_cont(0.5) within group (order by cost_usd), 0) as median_cost from per_user)
  select coalesce(jsonb_agg(r), '[]'::jsonb) from (
    select public.billing_mask_email(u.email) as user_masked, pu.operations, pu.failures,
           round(pu.cost_usd::numeric, 4) as cost_usd, round(coalesce(pu.cost_24h, 0)::numeric, 4) as cost_24h_usd,
           array_remove(array[
             case when pu.cost_usd > greatest(m.median_cost * 5, 0.5) then 'cost far above the typical user' end,
             case when pu.operations >= 10 and pu.failures * 2 >= pu.operations then 'half or more of requests failed' end,
             case when pu.operations >= 100 then 'very many requests' end,
             case when coalesce(pu.cost_24h, 0) > 1 and coalesce(pu.cost_24h, 0) > pu.cost_usd * 0.6 then 'most spend in the last 24 hours' end
           ], null) as flags
      from per_user pu join med m on true left join auth.users u on u.id = pu.user_id
     where pu.cost_usd > greatest(m.median_cost * 5, 0.5) or (pu.operations >= 10 and pu.failures * 2 >= pu.operations)
        or pu.operations >= 100 or (coalesce(pu.cost_24h, 0) > 1 and coalesce(pu.cost_24h, 0) > pu.cost_usd * 0.6)
     order by pu.cost_usd desc limit 20) r
$$;

-- 9. Plan limit on projects ----------------------------------------------------------------------------------------------------
-- Enforced in the database so no client can bypass it. Existing users who already hold more projects keep them.

create or replace function public.studies_enforce_plan_limit()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_max int; v_plan text;
begin
  v_plan := public.billing_user_plan(new.owner_id);
  select max_projects into v_max from public.plans where plan_key = v_plan;
  if v_max is not null and (select count(*) from public.studies where owner_id = new.owner_id) >= v_max then
    raise exception 'plan_project_limit' using errcode = 'P0001', detail = v_max::text, hint = v_plan;
  end if;
  return new;
end $$;
create trigger studies_plan_limit before insert on public.studies for each row execute function public.studies_enforce_plan_limit();

-- 10. Privileges -----------------------------------------------------------------------------------------------------------------

alter table public.billing_settings enable row level security;
alter table public.plans enable row level security;
alter table public.billing_prices enable row level security;
alter table public.credit_packs enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.ai_credit_lots enable row level security;
alter table public.ai_credit_allocations enable row level security;
alter table public.ai_credit_transactions enable row level security;
alter table public.app_admins enable row level security;

revoke all on table public.billing_settings, public.plans, public.billing_prices, public.credit_packs, public.payments, public.payment_events,
  public.ai_credit_lots, public.ai_credit_allocations, public.ai_credit_transactions, public.app_admins from public, anon, authenticated;

-- Plans, prices and packs are public information (they are shown on the pricing page).
grant select on public.plans, public.billing_prices, public.credit_packs to anon, authenticated;
create policy plans_read on public.plans for select to anon, authenticated using (active);
create policy billing_prices_read on public.billing_prices for select to anon, authenticated using (active);
create policy credit_packs_read on public.credit_packs for select to anon, authenticated using (active);

-- Signed-in users can read their own payments, purchased credit lots and credit transactions.
grant select (id, kind, product_key, amount, currency, status, method, created_at, fulfilled_at, refunded_at, user_id) on public.payments to authenticated;
grant select (id, user_id, source, credits_mcr, used_mcr, reserved_mcr, granted_at, expires_at, expired_at, note) on public.ai_credit_lots to authenticated;
grant select on public.ai_credit_transactions to authenticated;
create policy payments_select_own on public.payments for select to authenticated using (user_id = auth.uid());
create policy ai_credit_lots_select_own on public.ai_credit_lots for select to authenticated using (user_id = auth.uid());
create policy ai_credit_transactions_select_own on public.ai_credit_transactions for select to authenticated using (user_id = auth.uid());

-- Every billing and credit function is for the service role only.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'ai\_%' or p.proname like 'billing\_%' or p.proname in ('is_app_admin'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
