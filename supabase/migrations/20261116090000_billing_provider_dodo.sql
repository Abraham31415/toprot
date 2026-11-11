-- Payment provider: Dodo Payments (merchant of record), alongside the existing provider-neutral billing schema.
--
-- What changes:
--   * billing_provider_products   maps our plans and credit packs to the provider's product ids (set with SQL).
--   * ai_subscriptions            gets cancel_at_period_end, because the provider now renews Pro automatically.
--   * billing_create_payment      takes the provider name (default flutterwave, so existing callers keep working).
--   * billing_link_provider_subscription / billing_start_renewal_payment / billing_mark_subscription_cancel
--     let the backend attach the provider's subscription id to the user, turn an automatic renewal charge into a
--     payment row that billing_fulfill_payment then verifies and fulfils exactly like a first payment, and record a
--     cancellation. Credits and access still only ever change inside billing_fulfill_payment.

create table public.billing_provider_products (
  provider text not null,
  kind text not null check (kind in ('plan', 'pack')),
  product_key text not null,
  product_id text not null check (length(product_id) between 3 and 100),
  primary key (provider, kind, product_key)
);
create unique index billing_provider_products_pid_idx on public.billing_provider_products (provider, product_id);
alter table public.billing_provider_products enable row level security;
revoke all on table public.billing_provider_products from public, anon, authenticated;

alter table public.ai_subscriptions add column cancel_at_period_end boolean not null default false;

-- Same name with one more (defaulted) parameter: drop the old signature so calls are not ambiguous.
drop function if exists public.billing_create_payment(uuid, text, text, text, text);

create or replace function public.billing_create_payment(
  p_user uuid, p_kind text, p_product text, p_currency text, p_tx_ref text, p_provider text default 'flutterwave'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_price public.billing_prices%rowtype; s public.ai_subscriptions%rowtype; v_window int; v_pending int; v_id uuid;
begin
  if p_kind not in ('subscription', 'pack') or p_tx_ref is null or length(p_tx_ref) < 16 or p_currency !~ '^[A-Z]{3}$'
     or p_provider !~ '^[a-z][a-z0-9_]{1,30}$' then
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
    select * into s from public.ai_subscriptions where user_id = p_user;
    -- A subscription the provider renews automatically must not be bought twice: that would bill the customer twice.
    if found and s.provider = p_provider and s.provider_subscription_id is not null and s.status = 'active'
       and s.current_period_end > now() and not s.cancel_at_period_end then
      return jsonb_build_object('ok', false, 'code', 'already_subscribed', 'renews_on', s.current_period_end);
    end if;
    v_window := public.billing_setting_num('renewal_window_days')::int;
    if found and s.plan = p_product and s.status = 'active' and s.provider_subscription_id is null
       and s.current_period_end > now() + make_interval(days => v_window) then
      return jsonb_build_object('ok', false, 'code', 'too_early', 'renew_from', s.current_period_end - make_interval(days => v_window));
    end if;
  end if;

  select count(*) into v_pending from public.payments where user_id = p_user and created_at > now() - interval '1 hour';
  if v_pending >= public.billing_setting_num('max_pending_payments_per_hour') then
    return jsonb_build_object('ok', false, 'code', 'too_many_attempts');
  end if;

  insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency)
  values (p_user, p_provider, p_tx_ref, p_kind, p_product, v_price.amount, p_currency) returning id into v_id;
  return jsonb_build_object('ok', true, 'payment_id', v_id, 'amount', v_price.amount, 'currency', p_currency, 'tx_ref', p_tx_ref);
end $$;

-- After a first subscription payment is fulfilled: remember the provider's subscription id for renewals and cancellation.
create or replace function public.billing_link_provider_subscription(p_tx_ref text, p_provider_subscription_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare pay public.payments%rowtype;
begin
  if p_provider_subscription_id is null or length(p_provider_subscription_id) < 3 or length(p_provider_subscription_id) > 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into pay from public.payments where tx_ref = p_tx_ref;
  if not found or pay.kind <> 'subscription' or pay.status <> 'succeeded' or pay.user_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_applicable');
  end if;
  if exists (select 1 from public.ai_subscriptions where provider = pay.provider and provider_subscription_id = p_provider_subscription_id and user_id <> pay.user_id) then
    return jsonb_build_object('ok', false, 'code', 'subscription_belongs_to_another_user');
  end if;
  update public.ai_subscriptions set provider_subscription_id = p_provider_subscription_id, cancel_at_period_end = false, updated_at = now()
   where user_id = pay.user_id;
  return jsonb_build_object('ok', true);
end $$;

-- An automatic renewal charge. Creates the payment row (at our stored price) that the backend then verifies with the
-- provider and fulfils through billing_fulfill_payment, so renewals get exactly the same checks as a first payment.
create or replace function public.billing_start_renewal_payment(p_provider text, p_provider_subscription_id text, p_provider_payment_id text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare s public.ai_subscriptions%rowtype; v_price public.billing_prices%rowtype; v_existing public.payments%rowtype; v_ref text;
begin
  if p_provider_payment_id is null or length(p_provider_payment_id) < 3 or p_provider_subscription_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into v_existing from public.payments where provider = p_provider and provider_transaction_id = p_provider_payment_id;
  if found then return jsonb_build_object('ok', true, 'tx_ref', v_existing.tx_ref, 'existing', true); end if;
  select * into s from public.ai_subscriptions where provider = p_provider and provider_subscription_id = p_provider_subscription_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown_subscription'); end if;
  select * into v_price from public.billing_prices where kind = 'plan' and product_key = s.plan and currency = 'USD' and active;
  if not found then return jsonb_build_object('ok', false, 'code', 'no_price'); end if;
  v_ref := left('renewal-' || p_provider || '-' || p_provider_payment_id, 100);
  if length(v_ref) < 16 then v_ref := rpad(v_ref, 16, '0'); end if;
  insert into public.payments (user_id, provider, tx_ref, kind, product_key, amount, currency, meta)
  values (s.user_id, p_provider, v_ref, 'subscription', s.plan, v_price.amount, 'USD', jsonb_build_object('renewal', true))
  on conflict (tx_ref) do nothing;
  return jsonb_build_object('ok', true, 'tx_ref', v_ref, 'existing', false);
end $$;

-- Records that the provider will (or will not) renew a subscription. Access itself never depends on this flag: it ends at
-- the end of the period that was paid for.
create or replace function public.billing_mark_subscription_cancel(p_provider text, p_provider_subscription_id text, p_cancel boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.ai_subscriptions set cancel_at_period_end = coalesce(p_cancel, false), updated_at = now()
   where provider = p_provider and provider_subscription_id = p_provider_subscription_id;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;

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
