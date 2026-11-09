-- AI usage metering, credit ledger, and platform spend controls.
--
-- Units
--   * Money is integer micro-USD (1 USD = 1,000,000) of real Anthropic API cost.
--   * A user-facing "credit" is worth `credit_value_micro_usd` micro-USD (default 1000 =
--     $0.001), so 2,000 Pro credits = $2.00 of API cost at default pricing.
--   * The ledger stores credits in milli-credits ("mcr", 1 credit = 1000 mcr) so that
--     cheap calls are not rounded up to a whole credit.
--
-- Security model
--   * Every table below has RLS enabled and NO write policies. anon/authenticated have
--     no write grants, and no EXECUTE on any ai_* function. Only the service role (our
--     trusted server code) can reserve, commit, release or change entitlements.
--   * Charges are computed here, in SQL, from the server-side pricing table and the token
--     counts reported by the API response. Nothing a client or the model says can change
--     a balance, a limit, or a subscription.
--
-- Concurrency
--   * Every state-changing function takes row locks in the same order:
--       platform day row -> credit period row -> usage event row.
--     That total order makes deadlocks impossible and makes the balance check + reservation
--     atomic per user and for the platform budget.

-- 1. Settings, pricing, features -------------------------------------------------------

create table public.ai_settings (
  key         text primary key,
  value_num   bigint not null,
  description text not null,
  updated_at  timestamptz not null default now()
);

insert into public.ai_settings (key, value_num, description) values
  ('credit_value_micro_usd', 1000, 'Micro-USD of API cost represented by one user-facing credit (1000 = $0.001).'),
  ('free_intro_credits', 150, 'One-time introductory credits for users without an active Pro subscription. Does not reset.'),
  ('pro_period_credits', 2000, 'Credits granted per Pro billing period. Unused credits expire at period end.'),
  ('platform_daily_budget_micro_usd', 5000000, 'Hard platform-wide AI spend ceiling per UTC day, in micro-USD (5000000 = $5.00).'),
  ('max_concurrent_ops_per_user', 2, 'Maximum in-flight AI operations per user.'),
  ('max_ops_per_minute_per_user', 6, 'Maximum AI operations a user may start per rolling 60 seconds.'),
  ('reservation_lease_seconds', 300, 'A reservation not committed or released within this many seconds is expired and its credits freed.'),
  ('default_unpriced_tool_call_micro_usd', 20000, 'Conservative per-call charge for a billable tool that has no active row in ai_tool_pricing.');

create table public.ai_model_pricing (
  model_id                      text primary key,
  display_name                  text not null,
  tier                          text not null check (tier in ('light', 'standard', 'deep')),
  input_micro_per_mtok          bigint not null check (input_micro_per_mtok >= 0),
  output_micro_per_mtok         bigint not null check (output_micro_per_mtok >= 0),
  cache_read_micro_per_mtok     bigint not null check (cache_read_micro_per_mtok >= 0),
  cache_write_5m_micro_per_mtok bigint not null check (cache_write_5m_micro_per_mtok >= 0),
  cache_write_1h_micro_per_mtok bigint not null check (cache_write_1h_micro_per_mtok >= 0),
  max_input_tokens              int not null check (max_input_tokens > 0),
  cache_prices_verified         boolean not null default false,
  active                        boolean not null default true,
  pricing_verified_on           date not null,
  source                        text not null,
  updated_at                    timestamptz not null default now()
);

-- Per-million-token prices in micro-USD ($1.00 / MTok = 1,000,000). Base input/output
-- prices come from Anthropic's published model pricing (checked 2026-10-06). Cache read
-- is a documented figure where cache_prices_verified is true; otherwise it is the
-- conservative generic multiplier (read 0.1x, 5-minute write 1.25x, 1-hour write 2x of
-- the input price). Verify against the live pricing page before relying on cache savings,
-- and update this table (not code) when Anthropic changes prices.
insert into public.ai_model_pricing
  (model_id, display_name, tier, input_micro_per_mtok, output_micro_per_mtok,
   cache_read_micro_per_mtok, cache_write_5m_micro_per_mtok, cache_write_1h_micro_per_mtok,
   max_input_tokens, cache_prices_verified, pricing_verified_on, source)
values
  ('claude-haiku-5-5',  'Claude Haiku 5.5',  'light',     100000,   500000,  10000,   125000,   200000,  100000, false, '2026-10-06', 'Anthropic pricing, prompts up to 100K tokens only (max_input_tokens enforces this)'),
  ('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'standard', 2000000, 10000000, 200000, 2500000,  4000000, 200000, true,  '2026-10-06', 'Anthropic pricing'),
  ('claude-sonnet-5',   'Claude Sonnet 5',   'standard', 2000000, 10000000, 200000, 2500000,  4000000, 200000, true,  '2026-10-06', 'Anthropic pricing'),
  ('claude-opus-5-5',   'Claude Opus 5.5',   'deep',     4000000, 20000000, 200000, 5000000,  8000000, 200000, true,  '2026-10-06', 'Anthropic pricing'),
  ('claude-opus-5',     'Claude Opus 5',     'deep',     5000000, 25000000, 500000, 6250000, 10000000, 200000, false, '2026-10-06', 'Anthropic pricing'),
  ('claude-fable-5-1',  'Claude Fable 5.1',  'deep',    10000000, 50000000, 250000, 12500000, 20000000, 200000, true,  '2026-10-06', 'Anthropic pricing');

-- Billable server-side tools (e.g. web search), priced per call in micro-USD. Intentionally
-- empty: nothing in ToProt uses a billable tool yet. Add a verified row before enabling
-- one; until then any reported call is charged default_unpriced_tool_call_micro_usd.
create table public.ai_tool_pricing (
  tool_key           text primary key,
  micro_usd_per_call bigint not null check (micro_usd_per_call >= 0),
  active             boolean not null default true,
  notes              text,
  updated_at         timestamptz not null default now()
);

create table public.ai_features (
  feature_key           text primary key,
  description           text not null,
  -- Preferred model first, cheaper fallbacks after. The router picks the first one whose
  -- worst-case cost fits the user's credits and the platform budget.
  model_chain           text[] not null check (cardinality(model_chain) >= 1),
  max_output_tokens     int not null check (max_output_tokens > 0),
  max_input_chars       int not null check (max_input_chars > 0),
  max_iterations        int not null default 1 check (max_iterations >= 1),
  max_tool_calls        int not null default 0 check (max_tool_calls >= 0),
  max_op_cost_micro_usd bigint not null check (max_op_cost_micro_usd > 0),
  enabled               boolean not null default true,
  updated_at            timestamptz not null default now()
);

insert into public.ai_features
  (feature_key, description, model_chain, max_output_tokens, max_input_chars, max_iterations, max_tool_calls, max_op_cost_micro_usd)
values
  ('protocol_review',
   'Tier 3 reviewer questions on the protocol quality panel',
   array['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
   4096, 40000, 1, 0, 150000);

-- 2. Subscriptions and credit periods ---------------------------------------------------

create table public.ai_subscriptions (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  plan                     text not null check (plan in ('free', 'pro')),
  status                   text not null check (status in ('active', 'past_due', 'canceled', 'expired')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  provider                 text,
  provider_subscription_id text,
  last_event_at            timestamptz not null default 'epoch',
  updated_at               timestamptz not null default now(),
  check (plan <> 'pro' or status <> 'active' or
         (current_period_start is not null and current_period_end is not null
          and current_period_end > current_period_start))
);

-- Idempotency log for payment-provider events; the user link is kept (nulled) if the
-- account is deleted so payment history is not silently erased.
create table public.ai_subscription_events (
  provider    text not null,
  event_id    text not null,
  user_id     uuid references auth.users (id) on delete set null,
  event_time  timestamptz not null,
  plan        text not null,
  status      text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.ai_credit_periods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('pro', 'intro')),
  period_start  timestamptz not null,
  period_end    timestamptz,
  allowance_mcr bigint not null check (allowance_mcr >= 0),
  used_mcr      bigint not null default 0 check (used_mcr >= 0),
  reserved_mcr  bigint not null default 0 check (reserved_mcr >= 0),
  created_at    timestamptz not null default now(),
  unique (user_id, kind, period_start)
);

create table public.ai_platform_days (
  day                date primary key,
  budget_micro_usd   bigint not null,
  spent_micro_usd    bigint not null default 0 check (spent_micro_usd >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  updated_at         timestamptz not null default now()
);

create table public.ai_budget_alerts (
  day              date not null,
  threshold_pct    int not null check (threshold_pct in (50, 75, 90, 100)),
  spent_micro_usd  bigint not null,
  budget_micro_usd bigint not null,
  created_at       timestamptz not null default now(),
  notified_at      timestamptz,
  primary key (day, threshold_pct)
);

create table public.ai_usage_events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  period_id            uuid not null references public.ai_credit_periods (id) on delete cascade,
  idempotency_key      text not null,
  feature_key          text not null references public.ai_features (feature_key),
  model_id             text not null references public.ai_model_pricing (model_id),
  -- reserved: in flight. committed: finished, actual usage charged (possibly partial, see
  -- error_code). released/failed: nothing charged. expired: lease lapsed before finishing;
  -- a late commit is still accepted because the usage really happened.
  status               text not null check (status in ('reserved', 'committed', 'released', 'failed', 'expired')),
  reserved_mcr         bigint not null check (reserved_mcr >= 0),
  reserved_micro_usd   bigint not null check (reserved_micro_usd >= 0),
  charged_mcr          bigint not null default 0,
  cost_micro_usd       bigint not null default 0,
  input_tokens         bigint not null default 0,
  output_tokens        bigint not null default 0,
  cache_read_tokens    bigint not null default 0,
  cache_write_5m_tokens bigint not null default 0,
  cache_write_1h_tokens bigint not null default 0,
  tool_calls           int not null default 0,
  tool_usage           jsonb not null default '{}'::jsonb,
  unpriced_tools       text[] not null default '{}',
  iterations           int not null default 1,
  usage_known          boolean not null default true,
  overrun_mcr          bigint not null default 0,
  platform_exposure_micro_usd bigint not null default 0,
  platform_day         date not null,
  error_code           text,
  meta                 jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  finished_at          timestamptz,
  unique (user_id, idempotency_key)
);

create index ai_usage_events_user_created_idx on public.ai_usage_events (user_id, created_at desc);
create index ai_usage_events_period_idx on public.ai_usage_events (period_id);
create index ai_usage_events_lease_idx on public.ai_usage_events (expires_at) where status = 'reserved';

-- 3. Small helpers ---------------------------------------------------------------------

create or replace function public.ai_setting(p_key text)
returns bigint
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v bigint;
begin
  select value_num into v from public.ai_settings where key = p_key;
  if v is null then
    raise exception 'ai_setting % is missing', p_key using errcode = 'P0002';
  end if;
  return v;
end $$;

create or replace function public.ai_utc_day(p_ts timestamptz default now())
returns date
language sql immutable
as $$ select (p_ts at time zone 'utc')::date $$;

create or replace function public.ai_micro_to_mcr(p_micro bigint)
returns bigint
language sql stable security definer set search_path = public, pg_temp
as $$
  select ceil(p_micro::numeric * 1000 / public.ai_setting('credit_value_micro_usd'))::bigint
$$;

-- Authoritative cost of token usage for a model, in micro-USD, rounded up. Looks up the
-- model regardless of `active` so past events can still be billed after a model is retired.
create or replace function public.ai_cost_micro_usd(
  p_model text, p_input bigint, p_output bigint,
  p_cache_read bigint default 0, p_cache_write_5m bigint default 0, p_cache_write_1h bigint default 0
) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare m public.ai_model_pricing%rowtype;
begin
  select * into m from public.ai_model_pricing where model_id = p_model;
  if not found then
    raise exception 'unknown model %', p_model using errcode = 'P0002';
  end if;
  return ceil((
      p_input::numeric * m.input_micro_per_mtok
    + p_output::numeric * m.output_micro_per_mtok
    + p_cache_read::numeric * m.cache_read_micro_per_mtok
    + p_cache_write_5m::numeric * m.cache_write_5m_micro_per_mtok
    + p_cache_write_1h::numeric * m.cache_write_1h_micro_per_mtok
  ) / 1000000)::bigint;
end $$;

-- Cost of billable tool calls from a {tool_key: count} object. Tools without an active
-- price row are charged the conservative default and reported in o_unpriced.
create or replace function public.ai_tool_cost(
  p_usage jsonb, out o_cost bigint, out o_unpriced text[], out o_calls int
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare r record; price bigint; n int;
begin
  o_cost := 0; o_unpriced := '{}'; o_calls := 0;
  for r in select key, value from jsonb_each_text(coalesce(p_usage, '{}'::jsonb)) loop
    n := r.value::int;
    if n < 0 then raise exception 'negative tool count for %', r.key; end if;
    select micro_usd_per_call into price from public.ai_tool_pricing where tool_key = r.key and active;
    if price is null then
      price := public.ai_setting('default_unpriced_tool_call_micro_usd');
      o_unpriced := array_append(o_unpriced, r.key);
    end if;
    o_cost := o_cost + price * n;
    o_calls := o_calls + n;
  end loop;
end $$;

-- Which credit pool applies right now: an active Pro subscription inside its paid period,
-- otherwise the one-time introductory allowance.
create or replace function public.ai_entitlement(
  p_user uuid, p_now timestamptz default now(),
  out o_kind text, out o_period_start timestamptz, out o_period_end timestamptz, out o_allowance_mcr bigint
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare s public.ai_subscriptions%rowtype;
begin
  select * into s from public.ai_subscriptions where user_id = p_user;
  if found and s.plan = 'pro' and s.status = 'active'
     and s.current_period_start <= p_now and p_now < s.current_period_end then
    o_kind := 'pro';
    o_period_start := s.current_period_start;
    o_period_end := s.current_period_end;
    o_allowance_mcr := public.ai_setting('pro_period_credits') * 1000;
  else
    o_kind := 'intro';
    o_period_start := '1970-01-01 00:00:00+00'::timestamptz;
    o_period_end := null;
    o_allowance_mcr := public.ai_setting('free_intro_credits') * 1000;
  end if;
end $$;

-- Records each budget threshold the first time a day's actual spend crosses it.
create or replace function public.ai_check_alerts(p_day date)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare d public.ai_platform_days%rowtype; t int;
begin
  select * into d from public.ai_platform_days where day = p_day;
  if not found or d.budget_micro_usd <= 0 then return; end if;
  foreach t in array array[50, 75, 90, 100] loop
    if d.spent_micro_usd * 100 >= d.budget_micro_usd * t then
      insert into public.ai_budget_alerts (day, threshold_pct, spent_micro_usd, budget_micro_usd)
      values (p_day, t, d.spent_micro_usd, d.budget_micro_usd)
      on conflict do nothing;
    end if;
  end loop;
end $$;

-- 4. Expire stale reservations ---------------------------------------------------------
-- Called from ai_reserve (so it already holds today's platform row). Frees credits and
-- budget held by operations that never finished (crashed function, lost connection).

create or replace function public.ai_sweep_expired(p_now timestamptz default now())
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare r record; ev public.ai_usage_events%rowtype; n int := 0;
begin
  if not pg_try_advisory_xact_lock(727401) then return 0; end if;

  for r in
    select id, period_id, platform_day from public.ai_usage_events
    where status = 'reserved' and expires_at < p_now
    order by platform_day, period_id, id
    limit 200
  loop
    perform 1 from public.ai_platform_days where day = r.platform_day for update;
    perform 1 from public.ai_credit_periods where id = r.period_id for update;
    select * into ev from public.ai_usage_events where id = r.id for update;
    if ev.status <> 'reserved' or ev.expires_at >= p_now then continue; end if;

    update public.ai_usage_events set status = 'expired', finished_at = p_now where id = ev.id;
    update public.ai_credit_periods
       set reserved_mcr = greatest(reserved_mcr - ev.reserved_mcr, 0) where id = ev.period_id;
    update public.ai_platform_days
       set reserved_micro_usd = greatest(reserved_micro_usd - ev.reserved_micro_usd, 0), updated_at = now()
     where day = ev.platform_day;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 5. Reserve ---------------------------------------------------------------------------
-- Atomically checks the user's balance, rate limits and the platform budget, then holds
-- p_reserve_micro_usd (the caller's worst-case cost for the operation). Returns jsonb:
-- {ok: true, event_id, ...} or {ok: false, code, ...}. Never raises for business-rule
-- rejections so callers can map codes to messages.

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
  v_reserve_mcr bigint; v_available bigint; v_remaining bigint; v_count int; v_event uuid;
begin
  if p_key is null or length(p_key) < 8 or length(p_key) > 128
     or p_reserve_micro_usd is null or p_reserve_micro_usd <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  select * into v_feat from public.ai_features where feature_key = p_feature;
  if not found or not v_feat.enabled then
    return jsonb_build_object('ok', false, 'code', 'feature_disabled');
  end if;

  select * into v_price from public.ai_model_pricing where model_id = p_model and active;
  if not found or not (p_model = any (v_feat.model_chain)) then
    return jsonb_build_object('ok', false, 'code', 'unknown_model');
  end if;

  if p_reserve_micro_usd > v_feat.max_op_cost_micro_usd then
    return jsonb_build_object('ok', false, 'code', 'op_cost_too_high',
                              'max_op_cost_micro_usd', v_feat.max_op_cost_micro_usd);
  end if;

  -- Lock order: platform day -> (sweep) -> user period.
  v_budget := public.ai_setting('platform_daily_budget_micro_usd');
  insert into public.ai_platform_days (day, budget_micro_usd) values (v_day, v_budget)
  on conflict (day) do nothing;
  perform 1 from public.ai_platform_days where day = v_day for update;
  update public.ai_platform_days set budget_micro_usd = v_budget where day = v_day and budget_micro_usd <> v_budget;

  perform public.ai_sweep_expired(now());
  select * into v_day_row from public.ai_platform_days where day = v_day;

  select o_kind, o_period_start, o_period_end, o_allowance_mcr
    into v_kind, v_pstart, v_pend, v_allow from public.ai_entitlement(p_user, now());
  insert into public.ai_credit_periods (user_id, kind, period_start, period_end, allowance_mcr)
  values (p_user, v_kind, v_pstart, v_pend, v_allow)
  on conflict (user_id, kind, period_start) do nothing;
  select * into v_period from public.ai_credit_periods
   where user_id = p_user and kind = v_kind and period_start = v_pstart for update;

  select * into v_existing from public.ai_usage_events where user_id = p_user and idempotency_key = p_key;
  if found then
    return jsonb_build_object('ok', false, 'event_id', v_existing.id, 'status', v_existing.status,
      'code', case v_existing.status
                when 'committed' then 'duplicate_completed'
                when 'reserved' then 'duplicate_in_flight'
                else 'duplicate_failed' end);
  end if;

  select count(*) into v_count from public.ai_usage_events where user_id = p_user and status = 'reserved';
  if v_count >= public.ai_setting('max_concurrent_ops_per_user') then
    return jsonb_build_object('ok', false, 'code', 'too_many_concurrent');
  end if;
  select count(*) into v_count from public.ai_usage_events
   where user_id = p_user and created_at > now() - interval '60 seconds';
  if v_count >= public.ai_setting('max_ops_per_minute_per_user') then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;

  v_reserve_mcr := public.ai_micro_to_mcr(p_reserve_micro_usd);
  v_available := greatest(v_period.allowance_mcr - v_period.used_mcr - v_period.reserved_mcr, 0);
  if v_reserve_mcr > v_available then
    return jsonb_build_object('ok', false, 'code', 'insufficient_credits', 'plan', v_kind,
                              'available_mcr', v_available, 'required_mcr', v_reserve_mcr);
  end if;

  v_remaining := greatest(v_day_row.budget_micro_usd - v_day_row.spent_micro_usd - v_day_row.reserved_micro_usd, 0);
  if p_reserve_micro_usd > v_remaining then
    return jsonb_build_object('ok', false, 'code', 'platform_budget_exceeded',
                              'platform_remaining_micro_usd', v_remaining);
  end if;

  insert into public.ai_usage_events
    (user_id, period_id, idempotency_key, feature_key, model_id, status,
     reserved_mcr, reserved_micro_usd, platform_day, expires_at, meta)
  values
    (p_user, v_period.id, p_key, p_feature, p_model, 'reserved',
     v_reserve_mcr, p_reserve_micro_usd, v_day,
     now() + make_interval(secs => public.ai_setting('reservation_lease_seconds')::double precision),
     coalesce(p_meta, '{}'::jsonb))
  returning id into v_event;

  update public.ai_credit_periods set reserved_mcr = reserved_mcr + v_reserve_mcr where id = v_period.id;
  update public.ai_platform_days
     set reserved_micro_usd = reserved_micro_usd + p_reserve_micro_usd, updated_at = now()
   where day = v_day;

  return jsonb_build_object('ok', true, 'code', 'ok', 'event_id', v_event, 'period_id', v_period.id,
                            'plan', v_kind, 'reserved_mcr', v_reserve_mcr,
                            'available_mcr', v_available - v_reserve_mcr);
end $$;

-- 6. Commit ----------------------------------------------------------------------------
-- Settles a reservation against ACTUAL usage reported by the API response. Safe to call
-- more than once (idempotent). Accepts late commits for expired reservations because the
-- usage was real. The charge is never capped to the reservation: overruns are recorded.
-- p_platform_exposure_micro_usd adds platform-side cost the user is not charged for (e.g.
-- estimated output of an interrupted stream) so the daily budget is not under-counted.

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
  v_cost bigint; v_tool_cost bigint; v_unpriced text[]; v_tool_calls int;
  v_charged bigint; v_overrun bigint; v_was_reserved boolean;
begin
  if least(p_input, p_output, p_cache_read, p_cache_write_5m, p_cache_write_1h,
           coalesce(p_platform_exposure_micro_usd, 0)) < 0 or coalesce(p_iterations, 1) < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_usage');
  end if;

  select user_id, period_id, platform_day into v_probe from public.ai_usage_events where id = p_event;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  perform 1 from public.ai_platform_days where day = v_probe.platform_day for update;
  perform 1 from public.ai_credit_periods where id = v_probe.period_id for update;
  select * into v_ev from public.ai_usage_events where id = p_event for update;

  if v_ev.status = 'committed' then
    return jsonb_build_object('ok', true, 'duplicate', true,
                              'charged_mcr', v_ev.charged_mcr, 'cost_micro_usd', v_ev.cost_micro_usd);
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

  update public.ai_usage_events set
    status = 'committed', charged_mcr = v_charged, cost_micro_usd = v_cost,
    input_tokens = p_input, output_tokens = p_output, cache_read_tokens = p_cache_read,
    cache_write_5m_tokens = p_cache_write_5m, cache_write_1h_tokens = p_cache_write_1h,
    tool_calls = v_tool_calls, tool_usage = coalesce(p_tool_usage, '{}'::jsonb), unpriced_tools = v_unpriced,
    iterations = coalesce(p_iterations, 1), usage_known = p_usage_known, overrun_mcr = v_overrun,
    platform_exposure_micro_usd = coalesce(p_platform_exposure_micro_usd, 0),
    error_code = p_error_code, finished_at = now()
  where id = v_ev.id;

  update public.ai_credit_periods set
    reserved_mcr = case when v_was_reserved then greatest(reserved_mcr - v_ev.reserved_mcr, 0) else reserved_mcr end,
    used_mcr = used_mcr + v_charged
  where id = v_ev.period_id;

  update public.ai_platform_days set
    reserved_micro_usd = case when v_was_reserved then greatest(reserved_micro_usd - v_ev.reserved_micro_usd, 0) else reserved_micro_usd end,
    spent_micro_usd = spent_micro_usd + v_cost + coalesce(p_platform_exposure_micro_usd, 0),
    updated_at = now()
  where day = v_ev.platform_day;

  perform public.ai_check_alerts(v_ev.platform_day);

  return jsonb_build_object('ok', true, 'duplicate', false, 'charged_mcr', v_charged,
                            'cost_micro_usd', v_cost, 'overrun_mcr', v_overrun,
                            'unpriced_tools', to_jsonb(v_unpriced));
end $$;

-- 7. Release ---------------------------------------------------------------------------
-- Frees a reservation without charging the user (provider error before generation, or an
-- interrupted call whose usage cannot be known). Idempotent.

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
    error_code = p_error_code, usage_known = p_usage_known,
    platform_exposure_micro_usd = v_exposure, finished_at = now()
  where id = v_ev.id;

  if v_was_reserved then
    update public.ai_credit_periods
       set reserved_mcr = greatest(reserved_mcr - v_ev.reserved_mcr, 0) where id = v_ev.period_id;
  end if;

  update public.ai_platform_days set
    reserved_micro_usd = case when v_was_reserved then greatest(reserved_micro_usd - v_ev.reserved_micro_usd, 0) else reserved_micro_usd end,
    spent_micro_usd = spent_micro_usd + v_exposure,
    updated_at = now()
  where day = v_ev.platform_day;

  if v_exposure > 0 then perform public.ai_check_alerts(v_ev.platform_day); end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'status',
                            case when p_error_code is null then 'released' else 'failed' end);
end $$;

-- 8. Read models -----------------------------------------------------------------------
-- Balance and platform headroom for a user. Read-only (no rows created); reservations
-- that have outlived their lease are excluded even if not yet swept.

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
  v_budget bigint; v_period_id uuid;
begin
  select o_kind, o_period_start, o_period_end, o_allowance_mcr
    into v_kind, v_pstart, v_pend, v_allow from public.ai_entitlement(p_user, p_now);

  select * into v_period from public.ai_credit_periods
   where user_id = p_user and kind = v_kind and period_start = v_pstart;
  if found then
    v_period_id := v_period.id;
    v_allow := v_period.allowance_mcr; v_used := v_period.used_mcr; v_reserved := v_period.reserved_mcr;
    select coalesce(sum(reserved_mcr), 0) into v_stale from public.ai_usage_events
     where period_id = v_period.id and status = 'reserved' and expires_at < p_now;
  end if;

  v_budget := public.ai_setting('platform_daily_budget_micro_usd');
  select * into v_day_row from public.ai_platform_days where day = public.ai_utc_day(p_now);
  if found then
    v_p_spent := v_day_row.spent_micro_usd; v_p_reserved := v_day_row.reserved_micro_usd;
    select coalesce(sum(reserved_micro_usd), 0) into v_p_stale from public.ai_usage_events
     where platform_day = v_day_row.day and status = 'reserved' and expires_at < p_now;
  end if;

  return jsonb_build_object(
    'plan', v_kind, 'period_id', v_period_id,
    'period_start', case when v_kind = 'pro' then v_pstart else null end,
    'period_end', v_pend,
    'allowance_mcr', v_allow, 'used_mcr', v_used,
    'reserved_mcr', greatest(v_reserved - v_stale, 0),
    'available_mcr', greatest(v_allow - v_used - greatest(v_reserved - v_stale, 0), 0),
    'platform_remaining_micro_usd', greatest(v_budget - v_p_spent - greatest(v_p_reserved - v_p_stale, 0), 0),
    'credit_value_micro_usd', public.ai_setting('credit_value_micro_usd'));
end $$;

create or replace function public.ai_platform_status(p_day date default public.ai_utc_day(now()))
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare d public.ai_platform_days%rowtype; v_budget bigint;
begin
  v_budget := public.ai_setting('platform_daily_budget_micro_usd');
  select * into d from public.ai_platform_days where day = p_day;
  return jsonb_build_object(
    'day', p_day, 'budget_micro_usd', v_budget,
    'spent_micro_usd', coalesce(d.spent_micro_usd, 0),
    'reserved_micro_usd', coalesce(d.reserved_micro_usd, 0),
    'pct_spent', case when v_budget > 0 then round(coalesce(d.spent_micro_usd, 0) * 100.0 / v_budget, 1) else null end,
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('threshold_pct', threshold_pct,
               'created_at', created_at, 'notified_at', notified_at) order by threshold_pct)
               from public.ai_budget_alerts where day = p_day), '[]'::jsonb));
end $$;

-- 9. Subscription entitlement (called by a payment webhook once one is integrated) -------
-- Idempotent on (provider, event_id) and ignores events older than the last applied one,
-- so duplicate and out-of-order webhooks cannot grant or revoke access incorrectly.

create or replace function public.ai_apply_subscription_event(
  p_provider text, p_event_id text, p_event_time timestamptz, p_user uuid,
  p_plan text, p_status text, p_period_start timestamptz, p_period_end timestamptz,
  p_provider_subscription_id text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_rows int; v_existing public.ai_subscriptions%rowtype;
begin
  if p_plan not in ('free', 'pro') or p_status not in ('active', 'past_due', 'canceled', 'expired') then
    return jsonb_build_object('applied', false, 'reason', 'invalid');
  end if;
  if p_plan = 'pro' and p_status = 'active'
     and (p_period_start is null or p_period_end is null or p_period_end <= p_period_start) then
    return jsonb_build_object('applied', false, 'reason', 'invalid_period');
  end if;

  insert into public.ai_subscription_events (provider, event_id, user_id, event_time, plan, status)
  values (p_provider, p_event_id, p_user, p_event_time, p_plan, p_status)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('applied', false, 'reason', 'duplicate'); end if;

  select * into v_existing from public.ai_subscriptions where user_id = p_user for update;
  if found and v_existing.last_event_at > p_event_time then
    return jsonb_build_object('applied', false, 'reason', 'stale');
  end if;

  insert into public.ai_subscriptions
    (user_id, plan, status, current_period_start, current_period_end, provider,
     provider_subscription_id, last_event_at, updated_at)
  values (p_user, p_plan, p_status, p_period_start, p_period_end, p_provider,
          p_provider_subscription_id, p_event_time, now())
  on conflict (user_id) do update set
    plan = excluded.plan, status = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    provider = excluded.provider,
    provider_subscription_id = excluded.provider_subscription_id,
    last_event_at = excluded.last_event_at, updated_at = now();

  return jsonb_build_object('applied', true);
end $$;

-- 10. Administrator alert delivery -----------------------------------------------------
-- claim = mark notified and return the rows to send; if sending fails the caller releases
-- the claim so the alert is retried on the next operation.

create or replace function public.ai_claim_pending_alerts(p_limit int default 10)
returns setof public.ai_budget_alerts
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select day, threshold_pct from public.ai_budget_alerts
     where notified_at is null order by day, threshold_pct limit p_limit for update skip locked
  ), claimed as (
    update public.ai_budget_alerts a set notified_at = now()
      from picked p where a.day = p.day and a.threshold_pct = p.threshold_pct
    returning a.*
  )
  select * from claimed;
end $$;

create or replace function public.ai_release_alert_claim(p_day date, p_threshold int)
returns void
language sql security definer set search_path = public, pg_temp
as $$ update public.ai_budget_alerts set notified_at = null where day = p_day and threshold_pct = p_threshold $$;

-- Feature limits plus the pricing rows of its model chain (in preference order) in one call,
-- so the application never hardcodes prices or limits.
create or replace function public.ai_load_config(p_feature text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare f public.ai_features%rowtype; models jsonb;
begin
  select * into f from public.ai_features where feature_key = p_feature;
  if not found then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by c.ord), '[]'::jsonb) into models
    from unnest(f.model_chain) with ordinality as c(model_id, ord)
    join public.ai_model_pricing m on m.model_id = c.model_id and m.active;
  return jsonb_build_object('feature', to_jsonb(f), 'models', models,
    'credit_value_micro_usd', public.ai_setting('credit_value_micro_usd'));
end $$;

-- 11. Privileges -----------------------------------------------------------------------

alter table public.ai_settings            enable row level security;
alter table public.ai_model_pricing       enable row level security;
alter table public.ai_tool_pricing        enable row level security;
alter table public.ai_features            enable row level security;
alter table public.ai_subscriptions       enable row level security;
alter table public.ai_subscription_events enable row level security;
alter table public.ai_credit_periods      enable row level security;
alter table public.ai_platform_days       enable row level security;
alter table public.ai_budget_alerts       enable row level security;
alter table public.ai_usage_events        enable row level security;

revoke all on table
  public.ai_settings, public.ai_model_pricing, public.ai_tool_pricing, public.ai_features,
  public.ai_subscriptions, public.ai_subscription_events, public.ai_credit_periods,
  public.ai_platform_days, public.ai_budget_alerts, public.ai_usage_events
from public, anon, authenticated;

-- Signed-in users may read their own balance and history (never write). Internal columns
-- (cost, idempotency key, error codes, meta) are not granted.
grant select on public.ai_credit_periods to authenticated;
grant select on public.ai_subscriptions to authenticated;
grant select (id, period_id, feature_key, model_id, status, reserved_mcr, charged_mcr,
              input_tokens, output_tokens, created_at, finished_at, user_id)
  on public.ai_usage_events to authenticated;

create policy ai_credit_periods_select_own on public.ai_credit_periods
  for select to authenticated using (user_id = auth.uid());
create policy ai_subscriptions_select_own on public.ai_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy ai_usage_events_select_own on public.ai_usage_events
  for select to authenticated using (user_id = auth.uid());

-- Supabase grants EXECUTE on new functions to anon/authenticated by default, and
-- PostgREST exposes them as /rpc endpoints. Lock every ai_* function to the service role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'ai\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
