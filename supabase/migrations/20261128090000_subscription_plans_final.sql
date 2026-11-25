-- Final subscription configuration: Free, Pro, Advanced and Team. Prices, AI credits, project limits, Team shared-credit allowance per paid
-- seat, monthly expiry of unused shared credits, and Data Studio quotas.
--
--   Plan      Price (USD/month)   AI credits                                   Projects
--   free      0                   150 one time (introductory)                  3
--   pro       7.99                2,000 per paid billing period                25
--   advanced  15.99               5,000 per paid billing period                50
--   team      25.00 (3 seats)     7,500 shared per paid period, +2,000 for     unlimited team projects (fair-use limits in team_limits)
--             +6.00 per extra seat  each extra paid seat, to the team pool
--
-- Safe to apply to a live database and idempotent:
--   * No credit balance is reset and no historical transaction is changed. A credit period's allowance is fixed when the period starts, so a
--     new monthly credit amount applies from each customer's next paid period. Existing team pool balances are kept and are not made to
--     expire (they are treated like purchased credits); only shared credits granted from now on expire at the end of their period.
--   * No subscription period is changed.
--   * Checkout stays off for Advanced and Team. Advanced is created inactive (plans.active = false) and Team billing stays behind
--     teams_billing_enabled = 0 and its inactive plan row. Switch them on only after the provider products are mapped in
--     billing_provider_products and a test payment has been verified (docs/billing.md).
--
-- Accounting is unchanged: 1 credit = 1,000 micro-USD of API cost = 1,000 milli-credits; charges follow verified token usage; plan credits
-- are used before purchased credits; reservation, settlement, refunds and concurrency guards are the existing ledger functions.

-- 1. Plans ----------------------------------------------------------------------------------------------------------------------------------

-- Who buys a plan: a person (personal subscription) or a team (team subscription). The Team plan must never be sold as a personal
-- subscription: that would give one person the team's whole shared allowance as personal credits.
alter table public.plans add column if not exists audience text not null default 'individual' check (audience in ('individual', 'team'));

-- Advanced normally comes from 20261127090000; create it here too if that migration was skipped.
insert into public.plans (plan_key, name, tagline, is_paid, tier_rank, monthly_credits, intro_credits, max_projects, ai_features, bullets, active, sort)
select 'advanced', 'Toprot Advanced', 'Every statistical method in Data Studio, for individual researchers.', true, 2, 5000, 0, 50, p.ai_features, '{}', false, 2
  from public.plans p where p.plan_key = 'pro'
on conflict (plan_key) do nothing;

update public.plans set
  intro_credits = 150, monthly_credits = 0, max_projects = 3, tier_rank = 0, sort = 0, audience = 'individual',
  bullets = array['Research calculators, references, citation formatting and literature search', 'Up to 3 projects',
                  'Data Studio essentials: descriptive statistics, frequency tables, normality tests, common hypothesis tests, correlation, ANOVA and Table 1',
                  '150 one-time introductory AI credits for basic assistant tasks']
 where plan_key = 'free';

update public.plans set
  monthly_credits = 2000, max_projects = 25, tier_rank = 1, sort = 1, audience = 'individual',
  bullets = array['Up to 25 projects', 'The full AI research assistant, PDF questions and paper comparison',
                  'Data Studio: regression, diagnostic accuracy, ROC, reliability, Bland-Altman agreement and bootstrapping, with SVG, PNG and Python exports',
                  '2,000 AI credits each billing period; extra credit packs available']
 where plan_key = 'pro';

update public.plans set
  name = 'Toprot Advanced', tagline = 'Every statistical method in Data Studio, for individual researchers.',
  is_paid = true, monthly_credits = 5000, intro_credits = 0, max_projects = 50, tier_rank = 2, sort = 2, audience = 'individual',
  ai_features = (select ai_features from public.plans where plan_key = 'pro'),
  bullets = array['Everything in Pro', 'Up to 50 projects',
                  'Every Data Studio method: Kaplan-Meier and log-rank, Cox regression, Mantel-Haenszel, PCA and all advanced regression and epidemiology',
                  'Larger Data Studio quotas: 250,000 rows, 50 MB uploads, 1 GB per project',
                  '5,000 AI credits each billing period; extra credit packs available']
 where plan_key = 'advanced';

update public.plans set
  monthly_credits = 7500, intro_credits = 0, max_projects = null, tier_rank = 3, sort = 3, audience = 'team',
  bullets = array['Three paid seats included; extra seats per month', 'Every Data Studio method, the same as Advanced, on shared team projects',
                  'Shared projects, datasets, references and documents with role-based permissions and team administration',
                  '7,500 shared AI credits each billing period, plus 2,000 for each extra paid seat, with member limits',
                  'Unlimited team projects, subject to fair-use limits']
 where plan_key = 'team';

comment on column public.plans.monthly_credits is
  'Credits per paid billing period. For the team plan these go to the team''s shared pool (plus team_seat_monthly_credits per paid seat beyond team_base_paid_seats), never to a person.';
comment on column public.plans.audience is 'individual: a personal subscription (ai_subscriptions). team: sold only as a team subscription (team_subscriptions).';

-- Collaboration on personal projects: Advanced keeps everything Pro allows (reviewers, editors and viewers). Without these rows an Advanced
-- owner could not invite editors or viewers at all.
insert into public.collab_role_limits (plan_key, role, max_per_project)
select 'advanced', role, max_per_project from public.collab_role_limits where plan_key = 'pro'
on conflict (plan_key, role) do nothing;

-- 2. Prices (USD). The existing Pro, Team, seat and pack prices are restated so the configuration is complete in one place. ---------------
insert into public.billing_prices (kind, product_key, currency, amount) values
  ('plan', 'pro', 'USD', 7.99), ('plan', 'advanced', 'USD', 15.99), ('plan', 'team', 'USD', 25.00), ('plan', 'team_seat', 'USD', 6.00),
  ('pack', 'credits_2000', 'USD', 4.99), ('pack', 'credits_5000', 'USD', 9.99), ('pack', 'credits_10000', 'USD', 16.99)
on conflict (kind, product_key, currency) do update set amount = excluded.amount;

-- 3. Team shared-credit settings and pool expiry -------------------------------------------------------------------------------------------
insert into public.billing_settings (key, value_num, description) values
  ('team_seat_monthly_credits', 2000, 'Shared AI credits added to a team''s pool each paid period for every paid seat beyond team_base_paid_seats.')
on conflict (key) do nothing;

-- The unused part of the current period's shared grant. It is spent first (plan credits before purchased credits) and expires when the
-- period ends or the next period's grant arrives. Starts at 0, so balances that existed before this migration never expire.
alter table public.team_credit_pools add column if not exists period_grant_mcr bigint not null default 0 check (period_grant_mcr >= 0);
alter table public.team_credit_pools add column if not exists period_end timestamptz;

alter table public.team_credit_transactions drop constraint if exists team_credit_transactions_kind_check;
alter table public.team_credit_transactions add constraint team_credit_transactions_kind_check
  check (kind in ('subscription_grant', 'purchase', 'usage', 'refund', 'adjustment', 'expiry'));

-- Monthly shared allowance for a number of paid seats, in milli-credits.
create or replace function public.team_monthly_allowance_mcr(p_seats int) returns bigint language sql stable security definer set search_path = public, pg_temp
as $$
  select ((select coalesce(monthly_credits, 0) from public.plans where plan_key = 'team')
          + greatest(coalesce(p_seats, 0) - public.billing_setting_num('team_base_paid_seats')::int, 0) * public.billing_setting_num('team_seat_monthly_credits')::bigint)::bigint * 1000
$$;

-- Expires what is left of the current period's shared grant (never more than the pool can spare, never below zero).
create or replace function public.team_pool_expire_period(p_team uuid, p_note text default 'Unused shared credits from the billing period')
returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare pool public.team_credit_pools%rowtype; v_take bigint;
begin
  select * into pool from public.team_credit_pools where team_id = p_team for update;
  if not found or pool.period_grant_mcr <= 0 then return 0; end if;
  v_take := least(pool.period_grant_mcr, greatest(pool.balance_mcr - pool.reserved_mcr, 0));
  update public.team_credit_pools set balance_mcr = balance_mcr - v_take, period_grant_mcr = 0, updated_at = now() where team_id = p_team;
  if v_take > 0 then
    insert into public.team_credit_transactions (team_id, kind, amount_mcr, note) values (p_team, 'expiry', -v_take, p_note);
  end if;
  return v_take;
end $$;

-- Pool usage spends the period grant first.
create or replace function public.team_pool_usage_spends_grant() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.kind = 'usage' and new.amount_mcr < 0 then
    update public.team_credit_pools set period_grant_mcr = greatest(period_grant_mcr + new.amount_mcr, 0) where team_id = new.team_id;
  end if;
  return new;
end $$;
drop trigger if exists team_credit_usage_spends_grant on public.team_credit_transactions;
create trigger team_credit_usage_spends_grant after insert on public.team_credit_transactions for each row execute function public.team_pool_usage_spends_grant();

-- Called by billing_fulfill_payment after a provider-verified team payment. Safe to call once per payment (the caller is idempotent, and
-- team_pool_credit refuses a second grant for the same payment).
create or replace function public.team_apply_payment(p_pay public.payments)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.team_subscriptions%rowtype; v_base timestamptz; v_seats int; v_add int; v_credits bigint; v_before bigint; v_after bigint; pk public.credit_packs%rowtype;
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
    -- A new paid period: what is left of the last period's shared grant expires, then this period's grant (base plus paid extra seats) is added.
    insert into public.team_credit_pools (team_id) values (p_pay.team_id) on conflict do nothing;
    perform public.team_pool_expire_period(p_pay.team_id);
    v_credits := public.team_monthly_allowance_mcr(v_seats);
    select balance_mcr into v_before from public.team_credit_pools where team_id = p_pay.team_id for update;
    perform public.team_pool_credit(p_pay.team_id, v_credits, 'subscription_grant', p_pay.id, 'Teams billing period: ' || v_seats || ' paid seats', p_pay.user_id);
    select balance_mcr into v_after from public.team_credit_pools where team_id = p_pay.team_id;
    update public.team_credit_pools set period_grant_mcr = period_grant_mcr + (v_after - v_before), period_end = v_base + interval '1 month', updated_at = now() where team_id = p_pay.team_id;
  elsif p_pay.kind = 'team_seats' then
    -- Seats bought mid-period are paid in full, so each adds its full monthly shared credits to the current period.
    v_add := coalesce((p_pay.meta ->> 'add')::int, 0);
    update public.team_subscriptions set paid_seats = paid_seats + v_add, provider_seat_sync_pending = true, updated_at = now() where team_id = p_pay.team_id;
    v_credits := v_add::bigint * public.billing_setting_num('team_seat_monthly_credits')::bigint * 1000;
    insert into public.team_credit_pools (team_id) values (p_pay.team_id) on conflict do nothing;
    select balance_mcr into v_before from public.team_credit_pools where team_id = p_pay.team_id for update;
    perform public.team_pool_credit(p_pay.team_id, v_credits, 'subscription_grant', p_pay.id, 'Shared credits for ' || v_add || ' added seat(s)', p_pay.user_id);
    select balance_mcr into v_after from public.team_credit_pools where team_id = p_pay.team_id;
    update public.team_credit_pools set period_grant_mcr = period_grant_mcr + (v_after - v_before), updated_at = now() where team_id = p_pay.team_id;
  elsif p_pay.kind = 'team_pack' then
    select * into pk from public.credit_packs where pack_key = p_pay.product_key;
    if found then perform public.team_pool_credit(p_pay.team_id, pk.credits::bigint * 1000, 'purchase', p_pay.id, pk.name, p_pay.user_id); end if;
  end if;
end $$;

-- Daily housekeeping: lapsed subscriptions are marked expired (unchanged), and shared grants whose period has ended expire.
create or replace function public.team_billing_sweep() returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int; r record;
begin
  update public.team_subscriptions set status = 'expired', updated_at = now()
   where (status = 'past_due' and grace_until is not null and grace_until <= now()) or (status = 'active' and cancel_at_period_end and current_period_end <= now());
  get diagnostics n = row_count;
  for r in select team_id from public.team_credit_pools where period_grant_mcr > 0 and period_end is not null and period_end <= now() loop
    perform public.team_pool_expire_period(r.team_id);
  end loop;
  return n;
end $$;

-- 4. Personal checkout: the Team plan is not a personal plan, and a downgrade waits for the paid period to end ---------------------------
create or replace function public.billing_create_payment(
  p_user uuid, p_kind text, p_product text, p_currency text, p_tx_ref text, p_provider text default 'flutterwave'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_price public.billing_prices%rowtype; s public.ai_subscriptions%rowtype; v_window int; v_pending int; v_id uuid; v_new_rank int; v_cur_rank int;
begin
  if p_kind not in ('subscription', 'pack') or p_tx_ref is null or length(p_tx_ref) < 16 or p_currency !~ '^[A-Z]{3}$'
     or p_provider !~ '^[a-z][a-z0-9_]{1,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  if p_kind = 'subscription' then
    select tier_rank into v_new_rank from public.plans where plan_key = p_product and is_paid and active and audience = 'individual';
    if not found then
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

  if p_kind = 'pack' and coalesce(public.billing_setting_num('packs_require_subscription'), 1) >= 1 then
    -- Credit packs are an add-on for subscribers.
    if not exists (
      select 1 from public.ai_subscriptions a join public.plans p on p.plan_key = a.plan
       where a.user_id = p_user and a.status = 'active' and a.current_period_end > now() and p.is_paid
    ) then
      return jsonb_build_object('ok', false, 'code', 'subscription_required');
    end if;
  end if;

  if p_kind = 'subscription' then
    select * into s from public.ai_subscriptions where user_id = p_user;
    -- A subscription the provider renews automatically must not be bought twice: that would bill the customer twice.
    if found and s.provider = p_provider and s.provider_subscription_id is not null and s.status = 'active'
       and s.current_period_end > now() and not s.cancel_at_period_end then
      return jsonb_build_object('ok', false, 'code', 'already_subscribed', 'renews_on', s.current_period_end);
    end if;
    -- A downgrade never cuts short a higher plan that is already paid for: it can be bought once that period has ended.
    if found and s.status = 'active' and s.current_period_end > now() then
      select tier_rank into v_cur_rank from public.plans where plan_key = s.plan and is_paid;
      if v_cur_rank is not null and v_new_rank < v_cur_rank then
        return jsonb_build_object('ok', false, 'code', 'downgrade_at_period_end', 'available_from', s.current_period_end);
      end if;
    end if;
    v_window := public.billing_setting_num('renewal_window_days')::int;
    if found and s.plan = p_product and s.status = 'active' and s.provider_subscription_id is null
       and s.current_period_end > now() + make_interval(days => v_window) then
      return jsonb_build_object('ok', false, 'code', 'too_early', 'renew_from', s.current_period_end - make_interval(days => v_window));
    end if;
  end if;

  select count(*) into v_pending from public.payments
   where user_id = p_user and created_at > now() - interval '1 hour' and status in ('pending', 'succeeded');
  if v_pending >= public.billing_setting_num('max_pending_payments_per_hour') then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts');
  end if;

  insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency)
  values (p_user, p_provider, p_tx_ref, p_kind, p_product, v_price.amount, p_currency) returning id into v_id;
  return jsonb_build_object('ok', true, 'payment_id', v_id, 'amount', v_price.amount, 'currency', p_currency, 'tx_ref', p_tx_ref);
end $$;

-- An older five-argument overload (re-created by 20261124090000) has no pack or renewal rules. The application always passes p_provider,
-- so drop it so that nothing can reach the weaker version.
drop function if exists public.billing_create_payment(uuid, text, text, text, text);

-- billing_fulfill_payment: unchanged except that a personal subscription must be for a personal plan.
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
    select * into pl from public.plans where plan_key = pay.product_key and is_paid and audience = 'individual';
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

-- 5. Refunds undo only what the payment granted (now including the shared credits of added seats) ----------------------------------------
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
  elsif pay.kind in ('team_subscription', 'team_seats', 'team_pack') then
    if pay.kind = 'team_subscription' then
      update public.team_subscriptions set status = 'canceled', current_period_end = least(current_period_end, now() + interval '1 second'), grace_until = null, updated_at = now() where team_id = pay.team_id;
    elsif pay.kind = 'team_seats' then
      update public.team_subscriptions set paid_seats = greatest(paid_seats - coalesce((pay.meta ->> 'add')::int, 0), public.billing_setting_num('team_base_paid_seats')::int), provider_seat_sync_pending = true, updated_at = now() where team_id = pay.team_id;
    end if;
    select amount_mcr into v_credits from public.team_credit_transactions where payment_id = pay.id and kind = case when pay.kind = 'team_pack' then 'purchase' else 'subscription_grant' end;
    if v_credits is not null then
      select least(v_credits, balance_mcr - reserved_mcr) into v_take from public.team_credit_pools where team_id = pay.team_id for update;
      if coalesce(v_take, 0) > 0 then
        update public.team_credit_pools set balance_mcr = balance_mcr - v_take,
               period_grant_mcr = case when pay.kind = 'team_pack' then least(period_grant_mcr, balance_mcr - v_take) else greatest(period_grant_mcr - v_take, 0) end,
               updated_at = now() where team_id = pay.team_id;
        insert into public.team_credit_transactions (team_id, user_id, kind, amount_mcr, payment_id, note) values (pay.team_id, pay.user_id, 'refund', -v_take, pay.id, left(p_reason, 200));
      end if;
    end if;
  else
    update public.ai_subscriptions set status = 'canceled', current_period_end = least(current_period_end, now()), updated_at = now() where user_id = pay.user_id;
  end if;
  update public.payments set status = 'refunded', refunded_at = now(), failure_reason = left(p_reason, 200) where id = pay.id;
  return jsonb_build_object('ok', true);
end $$;

-- 6. What team members see: the same overviews plus the monthly shared allowance and the current period's unused grant ------------------
create or replace function public.team_billing_overview(p_actor uuid, p_team uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text := public.team_role_of(p_team, p_actor); s public.team_subscriptions%rowtype; v_ent jsonb := public.team_entitlements(p_team); v_seats int;
begin
  if v_role is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.team_subscriptions where team_id = p_team;
  v_seats := case when found and (v_ent ->> 'state') = 'active' then s.paid_seats else null end;
  return jsonb_build_object('your_role', v_role, 'entitlements', v_ent, 'billing_enabled', public.billing_setting_num('teams_billing_enabled') >= 1,
    'prices', jsonb_build_object('base', public.team_price('team'), 'seat', public.team_price('team_seat'), 'base_seats', public.billing_setting_num('team_base_paid_seats'), 'max_seats', public.billing_setting_num('team_max_paid_seats'),
      'monthly_credits', (select monthly_credits from public.plans where plan_key = 'team'), 'seat_credits', public.billing_setting_num('team_seat_monthly_credits')),
    'allowance', case when v_role in ('owner', 'administrator') and v_seats is not null then jsonb_build_object('paid_seats', v_seats,
        'extra_seats', greatest(v_seats - public.billing_setting_num('team_base_paid_seats')::int, 0),
        'monthly_allowance_mcr', public.team_monthly_allowance_mcr(v_seats),
        'extra_seat_credits_mcr', public.team_monthly_allowance_mcr(v_seats) - public.team_monthly_allowance_mcr(0)) else null end,
    'subscription', case when v_role = 'owner' and s.team_id is not null then jsonb_build_object('status', s.status, 'paid_seats', s.paid_seats, 'next_paid_seats', s.next_paid_seats, 'period_end', s.current_period_end,
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
        'monthly_team_limit_mcr', pool.monthly_team_limit_mcr, 'default_member_limit_mcr', pool.default_member_limit_mcr, 'month_used_mcr', public.team_ai_month_usage(p_team),
        'period_grant_mcr', pool.period_grant_mcr, 'period_end', pool.period_end) else null end,
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

-- 7. Data Studio quotas ----------------------------------------------------------------------------------------------------------------------
-- Advanced: larger individual quotas and every method. Rows x variables per dataset stay capped by the engine's 3,000,000-cell safeguard.
insert into public.ds_plan_limits
  (plan_key, max_datasets_per_project, max_rows, max_columns, max_upload_bytes, max_project_storage_bytes, max_versions_per_dataset, max_analyses_per_day, method_tier, exports)
values ('advanced', 50, 250000, 1000, 52428800, 1073741824, 500, 1500, 'advanced', array['csv', 'svg', 'png', 'python'])
on conflict (plan_key) do update set max_datasets_per_project = excluded.max_datasets_per_project, max_rows = excluded.max_rows, max_columns = excluded.max_columns,
  max_upload_bytes = excluded.max_upload_bytes, max_project_storage_bytes = excluded.max_project_storage_bytes, max_versions_per_dataset = excluded.max_versions_per_dataset,
  max_analyses_per_day = excluded.max_analyses_per_day, method_tier = excluded.method_tier, exports = excluded.exports, updated_at = now();
-- Team keeps its storage and dataset quotas; at least 3,000 analyses a day and every method.
update public.ds_plan_limits set max_analyses_per_day = greatest(max_analyses_per_day, 3000), method_tier = 'advanced', updated_at = now() where plan_key = 'team';

-- The raw-upload bucket's hard ceiling is the largest plan's upload limit; the server still enforces each project's own limit.
update storage.buckets set file_size_limit = greatest(coalesce(file_size_limit, 0), 52428800) where id = 'ds-uploads';

-- 8. Privileges: server only -----------------------------------------------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('team_monthly_allowance_mcr', 'team_pool_expire_period', 'team_pool_usage_spends_grant', 'team_apply_payment', 'team_billing_sweep',
       'billing_create_payment', 'billing_fulfill_payment', 'billing_refund_payment', 'team_billing_overview', 'team_ai_overview')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
