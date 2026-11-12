-- Two rules in billing_create_payment (same signature, so existing callers and grants are unaffected):
--   1. The hourly attempt limit counts only payments that are pending or succeeded. A checkout that failed (for example
--      because the payment provider was unreachable) no longer locks a customer out.
--   2. Credit packs can only be bought while the customer has an active paid subscription. A subscription that is set not to
--      renew still counts until the end of the period that was paid for.

-- The pack rule is a setting, like the other billing policies: 1 = packs need an active paid subscription, 0 = anyone may buy.
insert into public.billing_settings (key, value_num, description) values
  ('packs_require_subscription', 1, '1 = credit packs can only be bought with an active paid subscription; 0 = anyone may buy.')
on conflict (key) do nothing;

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

-- create or replace keeps the existing grants; re-apply the lock-down anyway so the result does not depend on that.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'billing_create_payment'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
