-- Collaboration, stage 5: Teams plan, paid seats, team credit pools and funding sources.
--
-- Everything here EXTENDS the existing billing design instead of duplicating it:
--   * Money in: the same `payments` table and the same Dodo verification path. New payment kinds (team_subscription, team_seats, team_pack)
--     are created by team_create_*_payment (owner only, price from billing_prices, nothing in code) and fulfilled by the same
--     billing_fulfill_payment, which now calls team_apply_payment. Only a provider-verified payment can change a team's entitlements.
--   * Entitlements: team_entitlements() (stage 3) now reads team_subscriptions. State is 'active' while the subscription is paid or in its
--     grace period, otherwise the team falls back to the unsubscribed limits. Nothing is deleted when a plan lapses.
--   * Credits: AI requests charge the requester's own credits by default. A team may OPT IN to a credit pool. A pool-funded request still goes
--     through the one existing reserve/commit ledger (platform budget, rate limits, idempotency) but is funded from a one-day "advance" lot
--     that the pool created for that single request; unused credit returns to the pool when the request settles. Balances cannot go negative
--     (check constraints), reservations are atomic, and every operation records its funding source.
--   * Not live until verified: the Team plan row is inactive and teams_billing_enabled is 0. Turning it on is a deliberate step after the
--     Dodo products are mapped in billing_provider_products and a test payment has been verified.
--   * Team entitlements and an owner's personal Pro plan are independent. Each is paid for by whoever buys it, a team member never pays for
--     the owner's seats, and a team project follows the team's limits only while the team's plan is active (otherwise the owner's own plan).

-- 1. Settings, plan, prices -----------------------------------------------------------------------------------------------------------------

insert into public.billing_settings (key, value_num, description) values
  ('teams_billing_enabled', 0, 'Set to 1 only after the Teams products are mapped at the payment provider and a test payment has been verified. 0 refuses Teams checkouts.'),
  ('team_base_paid_seats', 3, 'Paid seats included in the base Teams price.'),
  ('team_max_paid_seats', 50, 'Most paid seats a team may buy.'),
  ('team_grace_days', 7, 'How long a Teams subscription keeps its entitlements after a failed renewal payment.'),
  ('team_pool_advance_hours', 24, 'An advance lot for a pool-funded request expires after this many hours if never settled.')
on conflict (key) do nothing;

-- Proposed price: 25 USD per month for the base seats and 6 USD per extra seat. Inactive until the plan is switched on.
insert into public.plans (plan_key, name, tagline, is_paid, tier_rank, monthly_credits, intro_credits, max_projects, ai_features, bullets, active, sort)
select 'team', 'Toprot Teams', 'A shared workspace for a research group.', true, 2, 2000, 0, null, p.ai_features,
  array['Three paid seats included, extra seats per month', 'Shared projects, references and documents', 'Guest reviewers on a free guest seat', 'Optional shared AI credit pool with limits'], false, 2
  from public.plans p where p.plan_key = 'pro'
on conflict (plan_key) do nothing;
insert into public.billing_prices (kind, product_key, currency, amount) values ('plan', 'team', 'USD', 25.00), ('plan', 'team_seat', 'USD', 6.00)
on conflict (kind, product_key, currency) do nothing;
comment on column public.plans.monthly_credits is 'Credits per billing period. For the team plan these go to the team credit pool, not to a person.';

-- 2. Schema changes ---------------------------------------------------------------------------------------------------------------------------

alter table public.payments add column team_id uuid references public.teams (id) on delete set null;
alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('subscription', 'pack', 'team_subscription', 'team_seats', 'team_pack'));
create index payments_team_idx on public.payments (team_id, created_at desc) where team_id is not null;

alter table public.ai_usage_events
  add column funding_source text not null default 'self' check (funding_source in ('self', 'team')),
  add column funding_team_id uuid references public.teams (id) on delete set null,
  add column only_lot_id uuid references public.ai_credit_lots (id) on delete set null;
create index ai_usage_events_team_idx on public.ai_usage_events (funding_team_id, created_at desc) where funding_team_id is not null;

create table public.team_subscriptions (
  team_id uuid primary key references public.teams (id) on delete cascade,
  status text not null check (status in ('active', 'past_due', 'canceled', 'expired')),
  paid_seats int not null check (paid_seats >= 1),
  next_paid_seats int check (next_paid_seats is null or next_paid_seats >= 1),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null check (current_period_end > current_period_start),
  provider text,
  provider_subscription_id text,
  cancel_at_period_end boolean not null default false,
  grace_until timestamptz,
  -- The provider's subscription quantity is changed outside this database; true means it still has to be brought in line.
  provider_seat_sync_pending boolean not null default false,
  billing_owner uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index team_subscriptions_provider_idx on public.team_subscriptions (provider, provider_subscription_id) where provider_subscription_id is not null;

-- Replaces the stage 3 placeholder: the state comes from the subscription.
create or replace function public.team_entitlements(p_team uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s public.team_subscriptions%rowtype; v_state text := 'unsubscribed'; v_key text; v_paid int; v_guests int; v_projects int; v_storage int;
begin
  select * into s from public.team_subscriptions where team_id = p_team;
  if found then
    if s.status = 'active' and s.current_period_end > now() then v_state := 'active';
    elsif s.status = 'past_due' and s.grace_until is not null and s.grace_until > now() then v_state := 'active'; -- grace period after a failed renewal
    elsif s.status in ('active', 'past_due') then v_state := 'lapsed';
    else v_state := 'unsubscribed'; end if;
  end if;
  v_key := case when v_state = 'active' then 'team' else 'unsubscribed' end;
  select value into v_paid from public.team_limits where plan_key = v_key and limit_key = 'max_paid_seats';
  select value into v_guests from public.team_limits where plan_key = v_key and limit_key = 'max_guests';
  select value into v_projects from public.team_limits where plan_key = v_key and limit_key = 'max_projects';
  select value into v_storage from public.team_limits where plan_key = v_key and limit_key = 'max_storage_mb';
  if v_state = 'active' then v_paid := s.paid_seats; end if;
  return jsonb_build_object('state', v_state, 'max_paid_seats', coalesce(v_paid, 0), 'max_guests', coalesce(v_guests, 0), 'max_projects', coalesce(v_projects, 0), 'max_storage_mb', coalesce(v_storage, 0),
    'status', s.status, 'period_end', s.current_period_end, 'cancel_at_period_end', coalesce(s.cancel_at_period_end, false), 'grace_until', s.grace_until, 'next_paid_seats', s.next_paid_seats,
    'seat_sync_pending', coalesce(s.provider_seat_sync_pending, false));
end $$;

-- 3. Credit pool tables --------------------------------------------------------------------------------------------------------------------------

create table public.team_credit_pools (
  team_id uuid primary key references public.teams (id) on delete cascade,
  enabled boolean not null default false,
  balance_mcr bigint not null default 0 check (balance_mcr >= 0),
  reserved_mcr bigint not null default 0 check (reserved_mcr >= 0),
  monthly_team_limit_mcr bigint check (monthly_team_limit_mcr is null or monthly_team_limit_mcr >= 0),
  default_member_limit_mcr bigint check (default_member_limit_mcr is null or default_member_limit_mcr >= 0),
  updated_at timestamptz not null default now(),
  check (reserved_mcr <= balance_mcr)
);
create table public.team_credit_member_limits (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  monthly_limit_mcr bigint not null check (monthly_limit_mcr >= 0),
  primary key (team_id, user_id)
);
create table public.team_ai_reservations (
  event_id uuid primary key references public.ai_usage_events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  study_id uuid references public.studies (id) on delete set null,
  lot_id uuid references public.ai_credit_lots (id) on delete set null,
  reserved_mcr bigint not null check (reserved_mcr > 0),
  charged_mcr bigint not null default 0 check (charged_mcr >= 0),
  overrun_mcr bigint not null default 0 check (overrun_mcr >= 0),
  status text not null default 'open' check (status in ('open', 'settled')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index team_ai_reservations_team_idx on public.team_ai_reservations (team_id, created_at desc);
create index team_ai_reservations_open_idx on public.team_ai_reservations (created_at) where status = 'open';
create table public.team_ai_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  requested_mcr bigint not null check (requested_mcr > 0),
  reason text check (reason is null or length(reason) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  granted_mcr bigint check (granted_mcr is null or granted_mcr >= 0),
  period_month date not null default date_trunc('month', now() at time zone 'UTC')::date,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index team_ai_requests_team_idx on public.team_ai_requests (team_id, status, created_at desc);
create table public.team_credit_transactions (
  id bigint generated always as identity primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('subscription_grant', 'purchase', 'usage', 'refund', 'adjustment')),
  amount_mcr bigint not null,
  event_id uuid references public.ai_usage_events (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create unique index team_credit_transactions_payment_idx on public.team_credit_transactions (payment_id, kind) where payment_id is not null;
create index team_credit_transactions_team_idx on public.team_credit_transactions (team_id, created_at desc);
create table public.user_ai_funding (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.team_subscriptions enable row level security;
alter table public.team_credit_pools enable row level security;
alter table public.team_credit_member_limits enable row level security;
alter table public.team_ai_reservations enable row level security;
alter table public.team_ai_requests enable row level security;
alter table public.team_credit_transactions enable row level security;
alter table public.user_ai_funding enable row level security;
revoke all on table public.team_subscriptions, public.team_credit_pools, public.team_credit_member_limits, public.team_ai_reservations, public.team_ai_requests,
  public.team_credit_transactions, public.user_ai_funding from public, anon, authenticated;
-- Browsers read nothing here directly; the server shows what each role may see (see team_billing_overview and team_ai_overview).

-- 4. AI ledger: optional funding from a single advance lot --------------------------------------------------------------------------------

create or replace function public.ai_plan_key_allows(p_plan text, p_feature text) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.plans p where p.plan_key = p_plan and p_feature = any (p.ai_features)) $$;

drop function if exists public.ai_reserve(uuid, text, text, text, bigint, jsonb);
-- ai_reserve: the original, with two optional arguments (a single lot to fund from, and a plan whose features apply).
create or replace function public.ai_reserve(
  p_user uuid, p_key text, p_feature text, p_model text,
  p_reserve_micro_usd bigint, p_meta jsonb default '{}'::jsonb,
  p_only_lot uuid default null, p_plan_key text default null
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
  if not (case when p_only_lot is not null and p_plan_key is not null then public.ai_plan_key_allows(p_plan_key, p_feature) else public.ai_plan_allows(p_user, p_feature) end) then
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
  -- Funded from one specific lot (a team pool advance): the person's own subscription credits are never touched.
  if p_only_lot is not null then v_available := 0; end if;
  select coalesce(sum(credits_mcr - used_mcr - reserved_mcr), 0) into v_lots_avail
    from public.ai_credit_lots where user_id = p_user and expired_at is null and expires_at > now() and (p_only_lot is null or id = p_only_lot);
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
     reserved_mcr, reserved_lot_mcr, reserved_micro_usd, platform_day, expires_at, meta, only_lot_id)
  values
    (p_user, v_period.id, p_key, p_feature, p_model, 'reserved',
     v_reserve_mcr, v_lot_part, p_reserve_micro_usd, v_day,
     now() + make_interval(secs => public.ai_setting('reservation_lease_seconds')::double precision),
     coalesce(p_meta, '{}'::jsonb), p_only_lot)
  returning id into v_event;

  update public.ai_credit_periods set reserved_mcr = reserved_mcr + (v_reserve_mcr - v_lot_part) where id = v_period.id;

  v_left := v_lot_part;
  if v_left > 0 then
    for l in select id, credits_mcr - used_mcr - reserved_mcr as free from public.ai_credit_lots
              where user_id = p_user and expired_at is null and expires_at > now() and credits_mcr - used_mcr - reserved_mcr > 0 and (p_only_lot is null or id = p_only_lot)
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

-- ai_commit: the original, except that an event funded from a single lot is charged to that lot only.
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
  v_from_period := case when v_ev.only_lot_id is not null then 0 else least(v_charged, greatest(v_period.allowance_mcr - v_period.used_mcr, 0)) end;
  v_left := v_charged - v_from_period;
  if v_left > 0 then
    for l in select id, credits_mcr - used_mcr as rem from public.ai_credit_lots
              where user_id = v_ev.user_id and expired_at is null and expires_at > now() and credits_mcr - used_mcr > 0 and (v_ev.only_lot_id is null or id = v_ev.only_lot_id)
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
  -- For a pool-funded event any cost beyond the advance lot is recorded as the event's overrun only; it is never added to the person's own period.
  if v_from_period + v_left > 0 and v_ev.only_lot_id is null then
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

  if v_ev.only_lot_id is null then update public.ai_credit_periods set used_mcr = used_mcr + v_from_period + v_left where id = v_ev.period_id; end if;

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

-- 5. Money in: payments for teams ----------------------------------------------------------------------------------------------------------

create or replace function public.team_price(p_product text) returns numeric language sql stable security definer set search_path = public, pg_temp
as $$ select amount from public.billing_prices where kind = 'plan' and product_key = p_product and currency = 'USD' and active $$;

create or replace function public.team_seats_amount(p_seats int) returns numeric language sql stable security definer set search_path = public, pg_temp
as $$ select public.team_price('team') + greatest(p_seats - public.billing_setting_num('team_base_paid_seats')::int, 0) * public.team_price('team_seat') $$;

create or replace function public.team_pay_gate(p_actor uuid, p_team uuid, p_tx_ref text, p_currency text, p_provider text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if p_tx_ref is null or length(p_tx_ref) < 16 or p_currency <> 'USD' or p_provider !~ '^[a-z][a-z0-9_]{1,30}$' then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if public.billing_setting_num('teams_billing_enabled') < 1 or not exists (select 1 from public.plans where plan_key = 'team' and is_paid) then return jsonb_build_object('ok', false, 'code', 'teams_billing_off'); end if;
  if public.team_role_of(p_team, p_actor) is distinct from 'owner' then return jsonb_build_object('ok', false, 'code', 'not_team_owner'); end if;
  if (select count(*) from public.payments where user_id = p_actor and created_at > now() - interval '1 hour') >= public.billing_setting_num('max_pending_payments_per_hour') then return jsonb_build_object('ok', false, 'code', 'too_many_attempts'); end if;
  return null;
end $$;

create or replace function public.team_create_payment(p_actor uuid, p_team uuid, p_seats int, p_currency text, p_tx_ref text, p_provider text default 'dodo')
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare g jsonb := public.team_pay_gate(p_actor, p_team, p_tx_ref, p_currency, p_provider); s public.team_subscriptions%rowtype; v_amount numeric; v_id uuid; v_min int := public.billing_setting_num('team_base_paid_seats')::int;
begin
  if g is not null then return g; end if;
  if p_seats is null or p_seats < v_min or p_seats > public.billing_setting_num('team_max_paid_seats')::int then return jsonb_build_object('ok', false, 'code', 'invalid_seats'); end if;
  if p_seats < (select count(*) from public.team_memberships where team_id = p_team and seat_type = 'paid') then return jsonb_build_object('ok', false, 'code', 'seats_in_use'); end if;
  v_amount := public.team_seats_amount(p_seats);
  if v_amount is null then return jsonb_build_object('ok', false, 'code', 'no_price'); end if;
  select * into s from public.team_subscriptions where team_id = p_team;
  -- A subscription the provider renews by itself must not be bought twice.
  if found and s.provider_subscription_id is not null and s.status = 'active' and s.current_period_end > now() and not s.cancel_at_period_end then
    return jsonb_build_object('ok', false, 'code', 'already_subscribed', 'renews_on', s.current_period_end);
  end if;
  insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency, team_id, meta)
  values (p_actor, p_provider, p_tx_ref, 'team_subscription', 'team', v_amount, 'USD', p_team, jsonb_build_object('paid_seats', p_seats, 'extra_seats', greatest(p_seats - v_min, 0))) returning id into v_id;
  return jsonb_build_object('ok', true, 'payment_id', v_id, 'amount', v_amount, 'currency', 'USD', 'tx_ref', p_tx_ref, 'extra_seats', greatest(p_seats - v_min, 0));
end $$;

-- Adding seats mid-period: a one-off payment of the full seat price per added seat (the provider charge is not prorated, so what we verify is exactly what is charged).
-- The seats are available once the payment is verified, and renew with the team from the next period.
create or replace function public.team_create_seats_payment(p_actor uuid, p_team uuid, p_add int, p_currency text, p_tx_ref text, p_provider text default 'dodo')
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare g jsonb := public.team_pay_gate(p_actor, p_team, p_tx_ref, p_currency, p_provider); s public.team_subscriptions%rowtype; v_amount numeric; v_id uuid;
begin
  if g is not null then return g; end if;
  select * into s from public.team_subscriptions where team_id = p_team;
  if not found or s.status <> 'active' or s.current_period_end <= now() then return jsonb_build_object('ok', false, 'code', 'no_active_subscription'); end if;
  if p_add is null or p_add < 1 or s.paid_seats + p_add > public.billing_setting_num('team_max_paid_seats')::int then return jsonb_build_object('ok', false, 'code', 'invalid_seats'); end if;
  v_amount := p_add * public.team_price('team_seat');
  if v_amount is null then return jsonb_build_object('ok', false, 'code', 'no_price'); end if;
  insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency, team_id, meta)
  values (p_actor, p_provider, p_tx_ref, 'team_seats', 'team_seat', v_amount, 'USD', p_team, jsonb_build_object('add', p_add)) returning id into v_id;
  return jsonb_build_object('ok', true, 'payment_id', v_id, 'amount', v_amount, 'currency', 'USD', 'tx_ref', p_tx_ref);
end $$;

create or replace function public.team_create_pack_payment(p_actor uuid, p_team uuid, p_pack text, p_currency text, p_tx_ref text, p_provider text default 'dodo')
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare g jsonb := public.team_pay_gate(p_actor, p_team, p_tx_ref, p_currency, p_provider); v_price numeric; v_id uuid;
begin
  if g is not null then return g; end if;
  if (public.team_entitlements(p_team) ->> 'state') <> 'active' then return jsonb_build_object('ok', false, 'code', 'no_active_subscription'); end if;
  if not exists (select 1 from public.credit_packs where pack_key = p_pack and active) then return jsonb_build_object('ok', false, 'code', 'unknown_product'); end if;
  select amount into v_price from public.billing_prices where kind = 'pack' and product_key = p_pack and currency = 'USD' and active;
  if v_price is null then return jsonb_build_object('ok', false, 'code', 'currency_unavailable'); end if;
  insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency, team_id) values (p_actor, p_provider, p_tx_ref, 'team_pack', p_pack, v_price, 'USD', p_team) returning id into v_id;
  return jsonb_build_object('ok', true, 'payment_id', v_id, 'amount', v_price, 'currency', 'USD', 'tx_ref', p_tx_ref);
end $$;

create or replace function public.team_pool_credit(p_team uuid, p_amount bigint, p_kind text, p_payment uuid, p_note text, p_user uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_amount <= 0 then return; end if;
  insert into public.team_credit_transactions (team_id, user_id, kind, amount_mcr, payment_id, note) values (p_team, p_user, p_kind, p_amount, p_payment, p_note) on conflict do nothing;
  if not found then return; end if; -- this payment already credited the pool
  insert into public.team_credit_pools (team_id) values (p_team) on conflict do nothing;
  update public.team_credit_pools set balance_mcr = balance_mcr + p_amount, updated_at = now() where team_id = p_team;
end $$;

-- Called by billing_fulfill_payment after a provider-verified team payment. Safe to call once per payment (the caller is idempotent).
create or replace function public.team_apply_payment(p_pay public.payments)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.team_subscriptions%rowtype; v_base timestamptz; v_seats int; v_credits bigint; pk public.credit_packs%rowtype;
begin
  if p_pay.team_id is null then raise exception 'team_payment_without_team'; end if;
  if p_pay.kind = 'team_subscription' then
    v_seats := coalesce((p_pay.meta ->> 'paid_seats')::int, public.billing_setting_num('team_base_paid_seats')::int);
    select * into s from public.team_subscriptions where team_id = p_pay.team_id for update;
    v_base := case when found and s.status = 'active' and s.current_period_end > now() then s.current_period_end else now() end;
    insert into public.team_subscriptions (team_id, status, paid_seats, current_period_start, current_period_end, provider, billing_owner, updated_at)
    values (p_pay.team_id, 'active', v_seats, now(), v_base + interval '1 month', p_pay.provider, p_pay.user_id, now())
    on conflict (team_id) do update set status = 'active', paid_seats = excluded.paid_seats, next_paid_seats = null, current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end, provider = excluded.provider, billing_owner = excluded.billing_owner, grace_until = null, updated_at = now();
    select coalesce(monthly_credits, 0)::bigint * 1000 into v_credits from public.plans where plan_key = 'team';
    perform public.team_pool_credit(p_pay.team_id, coalesce(v_credits, 0), 'subscription_grant', p_pay.id, 'Teams billing period', p_pay.user_id);
  elsif p_pay.kind = 'team_seats' then
    update public.team_subscriptions set paid_seats = paid_seats + coalesce((p_pay.meta ->> 'add')::int, 0), provider_seat_sync_pending = true, updated_at = now() where team_id = p_pay.team_id;
  elsif p_pay.kind = 'team_pack' then
    select * into pk from public.credit_packs where pack_key = p_pay.product_key;
    if found then perform public.team_pool_credit(p_pay.team_id, pk.credits::bigint * 1000, 'purchase', p_pay.id, pk.name, p_pay.user_id); end if;
  end if;
end $$;

-- billing_fulfill_payment: the original, with one new branch for team payments. Everything else (idempotency, amount and currency checks,
-- duplicate transaction guard) is unchanged.
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
    -- A failed team renewal starts the grace period instead of cutting the team off at once.
    if pay.kind = 'team_subscription' and pay.team_id is not null and coalesce((pay.meta ->> 'renewal')::boolean, false) then
      update public.team_subscriptions set status = 'past_due', grace_until = coalesce(grace_until, now() + make_interval(days => public.billing_setting_num('team_grace_days')::int)), updated_at = now()
       where team_id = pay.team_id and status = 'active';
    end if;
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

  if pay.kind in ('team_subscription', 'team_seats', 'team_pack') then
    perform public.team_apply_payment(pay);
  elsif pay.kind = 'subscription' then
    select * into pl from public.plans where plan_key = pay.product_key and is_paid;
    if not found then return jsonb_build_object('ok', false, 'code', 'unknown_product'); end if;
    select * into sub from public.ai_subscriptions where user_id = pay.user_id for update;
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

-- Remember the provider's subscription id for a team after its first payment (renewals and cancellations are matched by it).
create or replace function public.team_link_provider_subscription(p_tx_ref text, p_provider_subscription_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare pay public.payments%rowtype;
begin
  if p_provider_subscription_id is null or length(p_provider_subscription_id) not between 3 and 100 then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  select * into pay from public.payments where tx_ref = p_tx_ref;
  if not found or pay.kind <> 'team_subscription' or pay.status <> 'succeeded' or pay.team_id is null then return jsonb_build_object('ok', false, 'code', 'not_applicable'); end if;
  if exists (select 1 from public.team_subscriptions where provider = pay.provider and provider_subscription_id = p_provider_subscription_id and team_id <> pay.team_id) then
    return jsonb_build_object('ok', false, 'code', 'subscription_belongs_to_another_team'); end if;
  update public.team_subscriptions set provider_subscription_id = p_provider_subscription_id, cancel_at_period_end = false, updated_at = now() where team_id = pay.team_id;
  return jsonb_build_object('ok', true);
end $$;

-- A provider renewal charge for a team: becomes a payment row (at our stored price, for the seats due) verified like a first payment.
create or replace function public.team_start_renewal_payment(p_provider text, p_provider_subscription_id text, p_provider_payment_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.team_subscriptions%rowtype; v_existing public.payments%rowtype; v_ref text; v_seats int; v_amount numeric;
begin
  if p_provider_payment_id is null or length(p_provider_payment_id) < 3 or p_provider_subscription_id is null then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  select * into v_existing from public.payments where provider = p_provider and provider_transaction_id = p_provider_payment_id;
  if found then return jsonb_build_object('ok', true, 'tx_ref', v_existing.tx_ref, 'existing', true); end if;
  select * into s from public.team_subscriptions where provider = p_provider and provider_subscription_id = p_provider_subscription_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown_subscription'); end if;
  v_seats := coalesce(s.next_paid_seats, s.paid_seats);
  v_amount := public.team_seats_amount(v_seats);
  if v_amount is null then return jsonb_build_object('ok', false, 'code', 'no_price'); end if;
  v_ref := left('renewal-' || p_provider || '-' || p_provider_payment_id, 100);
  if length(v_ref) < 16 then v_ref := rpad(v_ref, 16, '0'); end if;
  insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency, team_id, meta)
  values (s.billing_owner, p_provider, v_ref, 'team_subscription', 'team', v_amount, 'USD', s.team_id, jsonb_build_object('renewal', true, 'paid_seats', v_seats))
  on conflict (tx_ref) do nothing;
  return jsonb_build_object('ok', true, 'tx_ref', v_ref, 'existing', false);
end $$;

-- Provider lifecycle news for a team subscription. Access never depends on the flag alone: it ends with the paid period or the grace period.
create or replace function public.team_sync_subscription(p_provider text, p_provider_subscription_id text, p_state text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  if p_state not in ('active', 'cancel_at_period_end', 'on_hold', 'expired') then return jsonb_build_object('ok', false, 'code', 'invalid_state'); end if;
  update public.team_subscriptions set
    cancel_at_period_end = case when p_state = 'cancel_at_period_end' then true when p_state = 'active' then false else cancel_at_period_end end,
    status = case when p_state = 'on_hold' and status = 'active' then 'past_due' when p_state = 'expired' then 'expired' else status end,
    grace_until = case when p_state = 'on_hold' and status = 'active' then coalesce(grace_until, now() + make_interval(days => public.billing_setting_num('team_grace_days')::int)) else grace_until end,
    updated_at = now()
   where provider = p_provider and provider_subscription_id = p_provider_subscription_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

-- Daily housekeeping: a lapsed subscription is marked expired. Nothing is deleted.
create or replace function public.team_billing_sweep() returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.team_subscriptions set status = 'expired', updated_at = now()
   where (status = 'past_due' and grace_until is not null and grace_until <= now()) or (status = 'active' and cancel_at_period_end and current_period_end <= now());
  get diagnostics n = row_count;
  return n;
end $$;

-- Lowering seats takes effect at the next renewal and can never go below the seats in use.
create or replace function public.team_set_next_seats(p_actor uuid, p_team uuid, p_seats int) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.team_subscriptions%rowtype; v_used int; v_min int := public.billing_setting_num('team_base_paid_seats')::int;
begin
  if public.team_role_of(p_team, p_actor) is distinct from 'owner' then raise exception 'not_team_owner' using errcode = '42501'; end if;
  select * into s from public.team_subscriptions where team_id = p_team for update;
  if not found or s.status not in ('active', 'past_due') then raise exception 'no_active_subscription' using errcode = 'P0001'; end if;
  select (select count(*) from public.team_memberships where team_id = p_team and seat_type = 'paid') + (select count(*) from public.team_invitations where team_id = p_team and status = 'pending' and expires_at > now() and role <> 'guest') into v_used;
  if p_seats < v_min or p_seats < v_used then raise exception 'seats_in_use' using errcode = 'P0001', detail = v_used::text; end if;
  if p_seats > s.paid_seats then raise exception 'use_add_seats' using errcode = 'P0001'; end if;
  update public.team_subscriptions set next_paid_seats = case when p_seats = paid_seats then null else p_seats end, provider_seat_sync_pending = provider_seat_sync_pending or p_seats <> paid_seats, updated_at = now() where team_id = p_team;
  return jsonb_build_object('ok', true, 'effective', s.current_period_end, 'seats', p_seats);
end $$;

-- Refunds undo only what the payment granted.
create or replace function public.billing_refund_payment(p_payment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare pay public.payments%rowtype; lot public.ai_credit_lots%rowtype; v_credits bigint; v_take bigint;
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
  elsif pay.kind = 'team_subscription' then
    update public.team_subscriptions set status = 'canceled', current_period_end = least(current_period_end, now() + interval '1 second'), grace_until = null, updated_at = now() where team_id = pay.team_id;
    select amount_mcr into v_credits from public.team_credit_transactions where payment_id = pay.id and kind = 'subscription_grant';
    if v_credits is not null then
      select least(v_credits, balance_mcr - reserved_mcr) into v_take from public.team_credit_pools where team_id = pay.team_id for update;
      if coalesce(v_take, 0) > 0 then
        update public.team_credit_pools set balance_mcr = balance_mcr - v_take, updated_at = now() where team_id = pay.team_id;
        insert into public.team_credit_transactions (team_id, user_id, kind, amount_mcr, payment_id, note) values (pay.team_id, pay.user_id, 'refund', -v_take, pay.id, left(p_reason, 200));
      end if;
    end if;
  elsif pay.kind = 'team_seats' then
    update public.team_subscriptions set paid_seats = greatest(paid_seats - coalesce((pay.meta ->> 'add')::int, 0), public.billing_setting_num('team_base_paid_seats')::int), provider_seat_sync_pending = true, updated_at = now() where team_id = pay.team_id;
  elsif pay.kind = 'team_pack' then
    select amount_mcr into v_credits from public.team_credit_transactions where payment_id = pay.id and kind = 'purchase';
    if v_credits is not null then
      select least(v_credits, balance_mcr - reserved_mcr) into v_take from public.team_credit_pools where team_id = pay.team_id for update;
      if coalesce(v_take, 0) > 0 then
        update public.team_credit_pools set balance_mcr = balance_mcr - v_take, updated_at = now() where team_id = pay.team_id;
        insert into public.team_credit_transactions (team_id, user_id, kind, amount_mcr, payment_id, note) values (pay.team_id, pay.user_id, 'refund', -v_take, pay.id, left(p_reason, 200));
      end if;
    end if;
  else
    update public.ai_subscriptions set status = 'canceled', current_period_end = least(current_period_end, now()), updated_at = now() where user_id = pay.user_id;
  end if;
  update public.payments set status = 'refunded', refunded_at = now(), failure_reason = left(p_reason, 200) where id = pay.id;
  return jsonb_build_object('ok', true);
end $$;

-- 6. Pool settings, approvals and funding -----------------------------------------------------------------------------------------------------

create or replace function public.team_ai_pool_set(p_actor uuid, p_team uuid, p_enabled boolean, p_team_limit bigint, p_member_limit bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator') then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if (public.team_entitlements(p_team) ->> 'state') <> 'active' and p_enabled then raise exception 'no_active_subscription' using errcode = 'P0001'; end if;
  insert into public.team_credit_pools (team_id) values (p_team) on conflict do nothing;
  update public.team_credit_pools set enabled = p_enabled, monthly_team_limit_mcr = p_team_limit, default_member_limit_mcr = p_member_limit, updated_at = now() where team_id = p_team;
  perform public.team_log(p_team, p_actor, case when p_enabled then 'ai_pool_enabled' else 'ai_pool_disabled' end);
end $$;

create or replace function public.team_ai_member_limit_set(p_actor uuid, p_team uuid, p_user uuid, p_limit bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator') then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if public.team_role_of(p_team, p_user) is null then raise exception 'not_a_member' using errcode = 'P0002'; end if;
  if p_limit is null then delete from public.team_credit_member_limits where team_id = p_team and user_id = p_user;
  else insert into public.team_credit_member_limits (team_id, user_id, monthly_limit_mcr) values (p_team, p_user, p_limit) on conflict (team_id, user_id) do update set monthly_limit_mcr = excluded.monthly_limit_mcr; end if;
end $$;

create or replace function public.team_ai_request_more(p_actor uuid, p_team uuid, p_mcr bigint, p_reason text) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator', 'member') then raise exception 'not_team_member' using errcode = '42501'; end if;
  if p_mcr is null or p_mcr <= 0 or p_mcr > 100000000 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  if (select count(*) from public.team_ai_requests where user_id = p_actor and team_id = p_team and status = 'pending') >= 3 then raise exception 'too_many_requests' using errcode = 'P0001'; end if;
  insert into public.team_ai_requests (team_id, user_id, requested_mcr, reason) values (p_team, p_actor, p_mcr, left(btrim(p_reason), 500)) returning id into v_id;
  perform public.team_log(p_team, p_actor, 'ai_budget_requested');
  return v_id;
end $$;

create or replace function public.team_ai_decide(p_actor uuid, p_request uuid, p_approve boolean, p_granted bigint)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.team_ai_requests%rowtype;
begin
  select * into r from public.team_ai_requests where id = p_request for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if coalesce(public.team_role_of(r.team_id, p_actor), '') not in ('owner', 'administrator') then raise exception 'not_team_admin' using errcode = '42501'; end if;
  if r.status <> 'pending' then raise exception 'already_decided' using errcode = 'P0001'; end if;
  update public.team_ai_requests set status = case when p_approve then 'approved' else 'denied' end, granted_mcr = case when p_approve then least(coalesce(p_granted, r.requested_mcr), r.requested_mcr) end,
         decided_by = p_actor, decided_at = now() where id = p_request;
  perform public.collab_notify(r.user_id, 'team_ai_budget', null, case when p_approve then 'Your team AI budget request was approved' else 'Your team AI budget request was declined' end, null, '/billing');
  perform public.team_log(r.team_id, p_actor, case when p_approve then 'ai_budget_approved' else 'ai_budget_denied' end, r.user_id);
end $$;

create or replace function public.team_ai_set_funding(p_actor uuid, p_team uuid) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_team is null then delete from public.user_ai_funding where user_id = p_actor; return; end if;
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator', 'member') then raise exception 'not_team_member' using errcode = '42501'; end if;
  if not exists (select 1 from public.team_credit_pools where team_id = p_team and enabled) then raise exception 'pool_disabled' using errcode = 'P0001'; end if;
  insert into public.user_ai_funding (user_id, team_id) values (p_actor, p_team) on conflict (user_id) do update set team_id = excluded.team_id, updated_at = now();
end $$;

-- The team an account has chosen to fund its AI requests, only while that choice is still valid (pool on, seat held).
create or replace function public.team_ai_user_funding(p_user uuid) returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select f.team_id from public.user_ai_funding f join public.team_credit_pools p on p.team_id = f.team_id and p.enabled
   where f.user_id = p_user and coalesce(public.team_role_of(f.team_id, p_user), '') in ('owner', 'administrator', 'member')
$$;

create or replace function public.team_ai_month_usage(p_team uuid, p_user uuid default null) returns bigint language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(sum(case when status = 'open' then reserved_mcr else charged_mcr end), 0)::bigint from public.team_ai_reservations
   where team_id = p_team and (p_user is null or user_id = p_user) and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
$$;

create or replace function public.team_ai_member_allowance(p_team uuid, p_user uuid) returns bigint language sql stable security definer set search_path = public, pg_temp
as $$
  select case when coalesce(l.monthly_limit_mcr, p.default_member_limit_mcr) is null then null
    else coalesce(l.monthly_limit_mcr, p.default_member_limit_mcr) + coalesce((select sum(granted_mcr) from public.team_ai_requests r where r.team_id = p_team and r.user_id = p_user and r.status = 'approved'
         and r.period_month = date_trunc('month', now() at time zone 'UTC')::date), 0) end
    from public.team_credit_pools p left join public.team_credit_member_limits l on l.team_id = p.team_id and l.user_id = p_user where p.team_id = p_team
$$;

-- Reserve a pool-funded AI request. Atomic: either the pool hold, the advance lot and the ledger reservation all exist, or none do.
create or replace function public.team_ai_reserve(p_actor uuid, p_team uuid, p_study uuid, p_key text, p_feature text, p_model text, p_reserve_micro_usd bigint, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare pool public.team_credit_pools%rowtype; v_mcr bigint := public.ai_micro_to_mcr(p_reserve_micro_usd); v_lot uuid; r jsonb; v_allow bigint; v_ent jsonb := public.team_entitlements(p_team);
begin
  if p_reserve_micro_usd is null or p_reserve_micro_usd <= 0 or v_mcr <= 0 then return jsonb_build_object('ok', false, 'code', 'invalid_request'); end if;
  if coalesce(public.team_role_of(p_team, p_actor), '') not in ('owner', 'administrator', 'member') then return jsonb_build_object('ok', false, 'code', 'team_not_member'); end if;
  -- Credit never widens access: a request tied to a project needs a role on that project, exactly as without a pool.
  if p_study is not null and (public.study_role(p_study, p_actor) is null or (select team_id from public.studies where id = p_study) is distinct from p_team) then return jsonb_build_object('ok', false, 'code', 'team_not_allowed'); end if;
  if (v_ent ->> 'state') <> 'active' then return jsonb_build_object('ok', false, 'code', 'team_plan_inactive'); end if;
  select * into pool from public.team_credit_pools where team_id = p_team for update;
  if not found or not pool.enabled then return jsonb_build_object('ok', false, 'code', 'team_pool_disabled'); end if;
  if v_mcr > pool.balance_mcr - pool.reserved_mcr then return jsonb_build_object('ok', false, 'code', 'team_pool_exhausted', 'available_mcr', pool.balance_mcr - pool.reserved_mcr); end if;
  if pool.monthly_team_limit_mcr is not null and public.team_ai_month_usage(p_team) + v_mcr > pool.monthly_team_limit_mcr then return jsonb_build_object('ok', false, 'code', 'team_limit_reached'); end if;
  v_allow := public.team_ai_member_allowance(p_team, p_actor);
  if v_allow is not null and public.team_ai_month_usage(p_team, p_actor) + v_mcr > v_allow then return jsonb_build_object('ok', false, 'code', 'member_limit_reached', 'allowance_mcr', v_allow); end if;

  begin
    insert into public.ai_credit_lots (user_id, source, credits_mcr, expires_at, note)
    values (p_actor, 'grant', v_mcr, now() + make_interval(hours => public.billing_setting_num('team_pool_advance_hours')::int), 'Team pool advance') returning id into v_lot;
    insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, lot_id, note) values (p_actor, 'adjustment', 'purchased', v_mcr, v_lot, 'Team pool advance for one request');
    r := public.ai_reserve(p_actor, p_key, p_feature, p_model, p_reserve_micro_usd, coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('funding', 'team'), v_lot, 'team');
    if (r ->> 'ok') is distinct from 'true' then raise exception 'team_reserve_refused:%', coalesce(r ->> 'code', 'internal'); end if;
    update public.ai_usage_events set funding_source = 'team', funding_team_id = p_team where id = (r ->> 'event_id')::uuid;
    insert into public.team_ai_reservations (event_id, team_id, user_id, study_id, lot_id, reserved_mcr) values ((r ->> 'event_id')::uuid, p_team, p_actor, p_study, v_lot, v_mcr);
    update public.team_credit_pools set reserved_mcr = reserved_mcr + v_mcr, updated_at = now() where team_id = p_team;
  exception when others then
    if sqlerrm like 'team_reserve_refused:%' then return jsonb_build_object('ok', false, 'code', substring(sqlerrm from 'team_reserve_refused:(.*)$'), 'event_id', r ->> 'event_id'); end if;
    raise;
  end;
  return r || jsonb_build_object('funding', 'team');
end $$;

-- Settle after ai_commit or ai_release (idempotent). The pool pays what the request actually used; the rest of the advance returns to the pool.
create or replace function public.team_ai_settle(p_event uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare res public.team_ai_reservations%rowtype; ev public.ai_usage_events%rowtype; lot public.ai_credit_lots%rowtype; v_used bigint; v_left bigint;
begin
  select * into res from public.team_ai_reservations where event_id = p_event for update;
  if not found or res.status = 'settled' then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into ev from public.ai_usage_events where id = p_event;
  if ev.status = 'reserved' and ev.expires_at > now() then return jsonb_build_object('ok', false, 'code', 'in_flight'); end if;
  perform 1 from public.team_credit_pools where team_id = res.team_id for update;
  select * into lot from public.ai_credit_lots where id = res.lot_id for update;
  v_used := coalesce(lot.used_mcr, 0);
  if ev.status = 'reserved' then perform public.ai_free_reservation(p_event); end if; -- lease expired without a settlement: release what was held
  select * into lot from public.ai_credit_lots where id = res.lot_id;
  v_left := coalesce(lot.credits_mcr - lot.used_mcr, 0);
  if lot.id is not null and lot.expired_at is null then
    update public.ai_credit_lots set expired_at = now() where id = lot.id;
    if v_left > 0 then insert into public.ai_credit_transactions (user_id, kind, pool, amount_mcr, lot_id, note) values (lot.user_id, 'expiry', 'purchased', -v_left, lot.id, 'Team pool advance returned'); end if;
  end if;
  update public.team_credit_pools set balance_mcr = balance_mcr - v_used, reserved_mcr = reserved_mcr - res.reserved_mcr, updated_at = now() where team_id = res.team_id;
  if v_used > 0 then insert into public.team_credit_transactions (team_id, user_id, kind, amount_mcr, event_id, note) values (res.team_id, res.user_id, 'usage', -v_used, p_event, ev.feature_key); end if;
  update public.team_ai_reservations set status = 'settled', charged_mcr = v_used, overrun_mcr = greatest(coalesce(ev.charged_mcr, 0) - v_used, 0), settled_at = now() where event_id = p_event;
  return jsonb_build_object('ok', true, 'charged_mcr', v_used, 'returned_mcr', v_left);
end $$;

-- Reconciliation: settle anything left open, and repair and report any drift between pool holds and open reservations.
create or replace function public.team_ai_reconcile() returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; v_settled int := 0; v_drift int := 0; v_open bigint;
begin
  perform public.ai_sweep_expired(now());
  for r in select event_id from public.team_ai_reservations where status = 'open' and created_at < now() - interval '2 minutes' loop
    if (public.team_ai_settle(r.event_id) ->> 'ok') = 'true' then v_settled := v_settled + 1; end if;
  end loop;
  for r in select p.team_id, p.reserved_mcr from public.team_credit_pools p loop
    select coalesce(sum(reserved_mcr), 0) into v_open from public.team_ai_reservations where team_id = r.team_id and status = 'open';
    if v_open <> r.reserved_mcr then
      v_drift := v_drift + 1;
      update public.team_credit_pools set reserved_mcr = least(v_open, balance_mcr), updated_at = now() where team_id = r.team_id;
      perform public.system_alert_raise('team_pool_drift', 'critical', 'A team credit pool hold did not match its open reservations and was corrected', jsonb_build_object('team', r.team_id, 'held', r.reserved_mcr, 'open', v_open), 'team_pool_drift:' || r.team_id);
    end if;
  end loop;
  return jsonb_build_object('settled', v_settled, 'drift_fixed', v_drift);
end $$;

-- 7. What each person may see ---------------------------------------------------------------------------------------------------------------------

create or replace function public.team_billing_overview(p_actor uuid, p_team uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text := public.team_role_of(p_team, p_actor); s public.team_subscriptions%rowtype; v_ent jsonb := public.team_entitlements(p_team);
begin
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.team_subscriptions where team_id = p_team;
  return jsonb_build_object('your_role', v_role, 'entitlements', v_ent, 'billing_enabled', public.billing_setting_num('teams_billing_enabled') >= 1,
    'prices', jsonb_build_object('base', public.team_price('team'), 'seat', public.team_price('team_seat'), 'base_seats', public.billing_setting_num('team_base_paid_seats'), 'max_seats', public.billing_setting_num('team_max_paid_seats'), 'monthly_credits', (select monthly_credits from public.plans where plan_key = 'team')),
    'subscription', case when v_role = 'owner' and found then jsonb_build_object('status', s.status, 'paid_seats', s.paid_seats, 'next_paid_seats', s.next_paid_seats, 'period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end, 'grace_until', s.grace_until, 'seat_sync_pending', s.provider_seat_sync_pending, 'renews_automatically', s.provider_subscription_id is not null) else null end,
    'payments', case when v_role = 'owner' then coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'currency', currency, 'status', status, 'at', created_at) order by created_at desc)
        from (select * from public.payments where team_id = p_team order by created_at desc limit 12) x), '[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function public.team_ai_overview(p_actor uuid, p_team uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text := public.team_role_of(p_team, p_actor); pool public.team_credit_pools%rowtype; v_admin boolean;
begin
  if coalesce(v_role, '') not in ('owner', 'administrator', 'member') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_admin := v_role in ('owner', 'administrator');
  select * into pool from public.team_credit_pools where team_id = p_team;
  return jsonb_build_object('your_role', v_role,
    'pool', case when found then jsonb_build_object('enabled', pool.enabled, 'balance_mcr', pool.balance_mcr, 'reserved_mcr', pool.reserved_mcr, 'available_mcr', pool.balance_mcr - pool.reserved_mcr,
        'monthly_team_limit_mcr', pool.monthly_team_limit_mcr, 'default_member_limit_mcr', pool.default_member_limit_mcr, 'month_used_mcr', public.team_ai_month_usage(p_team)) else null end,
    'you', jsonb_build_object('used_mcr', public.team_ai_month_usage(p_team, p_actor), 'allowance_mcr', public.team_ai_member_allowance(p_team, p_actor), 'using_pool', public.team_ai_user_funding(p_actor) = p_team),
    'members', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', pr.full_name, 'used_mcr', public.team_ai_month_usage(p_team, m.user_id),
        'allowance_mcr', public.team_ai_member_allowance(p_team, m.user_id), 'override_mcr', l.monthly_limit_mcr) order by pr.full_name)
        from public.team_memberships m join public.profiles pr on pr.id = m.user_id left join public.team_credit_member_limits l on l.team_id = m.team_id and l.user_id = m.user_id
       where m.team_id = p_team and m.seat_type = 'paid'), '[]'::jsonb) else '[]'::jsonb end,
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'user_id', r.user_id, 'full_name', pr.full_name, 'requested_mcr', r.requested_mcr, 'reason', r.reason, 'status', r.status, 'granted_mcr', r.granted_mcr, 'at', r.created_at) order by r.created_at desc)
        from (select * from public.team_ai_requests where team_id = p_team and (v_admin or user_id = p_actor) order by created_at desc limit 30) r join public.profiles pr on pr.id = r.user_id), '[]'::jsonb),
    'transactions', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('kind', t.kind, 'amount_mcr', t.amount_mcr, 'user', pr.full_name, 'note', t.note, 'at', t.created_at) order by t.created_at desc)
        from (select * from public.team_credit_transactions where team_id = p_team order by created_at desc limit 25) t left join public.profiles pr on pr.id = t.user_id), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- 8. Privileges --------------------------------------------------------------------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'ai\_%' or p.proname like 'billing\_%' or p.proname like 'team\_%' or p.proname like 'collab\_%' or p.proname in ('is_app_admin', 'study_link_reference', 'study_unlink_reference'))
       and p.proname not in ('team_role', 'team_is_paid_member', 'team_is_member', 'team_doc_can_read', 'team_doc_storage_can_read', 'team_doc_storage_can_insert', 'collab_message_visible', 'collab_can_read_conversation')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
