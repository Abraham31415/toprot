# Billing, plans and payments

Code: `frontend/src/lib/billing/`, `frontend/src/app/billing/`, `frontend/src/app/api/billing/`, `frontend/src/app/admin/billing/`.
Schema: `supabase/migrations/20261115090000_billing_plans_payments.sql` (extends `20261109120000_ai_usage_credits.sql`).

## How it works

- **Plans, prices, packs and quotas are data.** Tables `plans`, `billing_prices`, `credit_packs`, `billing_settings`. Change them with SQL; the pricing page, billing page and checkout read them. Nothing is hard-coded in the app.
- **Two credit pools.** Plan credits (the existing per-period allowance: introductory credits on Free, monthly credits on a paid plan) and purchased credits (expiring *lots*). A reservation and a charge use plan credits first, then purchased lots by earliest expiry. Every movement is written to `ai_credit_transactions`.
- **Plan gating is in Postgres.** `ai_reserve` refuses a feature the user's plan does not include (`plan_required`). A trigger on `studies` enforces the plan's project limit. Neither the browser nor the model can change either.
- **Payments.** A `pending` payment row is created at the stored price *before* checkout. Credits or a subscription are issued only by `billing_fulfill_payment`, which the backend calls after it has re-fetched the transaction from Flutterwave and checked status, reference, amount and currency. It is idempotent, and one provider transaction can never pay for two orders.
- **Three ways a payment is confirmed**, all running the same verification: the customer's redirect (`/billing/return`), the webhook (`/api/billing/webhook`), and a daily reconciliation job (`/api/billing/maintenance`) that re-checks anything still pending and expires credits.

## Going live: checklist

1. Apply the migration in Supabase (production).
2. Create a Flutterwave account and use **test mode** first. Copy the test **secret key** (`FLWSECK_TEST-...`).
3. In Flutterwave: Settings > Webhooks. URL `https://toprot.vercel.app/api/billing/webhook`. Choose a random **secret hash** and enable retries.
4. In Vercel (Project > Settings > Environment Variables) set:
   - `FLW_SECRET_KEY` = the test secret key
   - `FLW_WEBHOOK_HASH` = the secret hash from step 3
   - `CRON_SECRET` = 16+ random characters (the daily job runs only with it)
5. Redeploy. Make a test purchase with Flutterwave's test cards. Confirm the plan or credits appear only after the confirmation, and that a second webhook delivery changes nothing.
6. To go live: use the live secret key and set `BILLING_LIVE_ENABLED=true`. **A live key is refused without that flag**, so it cannot be used by accident.
7. Make yourself an administrator (in the Supabase SQL editor): `insert into app_admins (user_id) select id from auth.users where email = 'YOUR EMAIL';` then open `/admin/billing`.
8. Review the Terms and Privacy pages. They were updated to match this behaviour but are not legal advice.

## Ugandan Mobile Money

Mobile Money is charged in UGX. UGX prices are intentionally **not** seeded. Set them yourself (and check Flutterwave's fees and your enabled payment methods) before offering it:

```sql
insert into billing_prices (kind, product_key, currency, amount) values
  ('plan', 'pro', 'UGX', 29000), ('pack', 'credits_2000', 'UGX', 18000),
  ('pack', 'credits_5000', 'UGX', 36000), ('pack', 'credits_10000', 'UGX', 62000);
```

(Example numbers only.) Checkout offers `mobilemoneyuganda` only for UGX. Flutterwave applies `payment_options` only if "Disable preferred payment methods" is off in your dashboard.

## Recurring payments: what is and is not built

Subscriptions are **manual-renewal**: each month is its own verified payment, and the Billing page invites renewal during the last `renewal_window_days` of the period. This is deliberate. Flutterwave's documentation does not confirm recurring or tokenised charges for Ugandan Mobile Money, and card recurring depends on the merchant account. **Confirm with Flutterwave which of these your merchant account supports before adding automatic renewal.** If it does, the work is a Flutterwave payment plan plus handling renewal webhooks (matching them to a user); the schema already has `provider_subscription_id` for it.

## Operating it

```sql
-- change a price or quota (takes effect immediately)
update billing_prices set amount = 8.99 where kind = 'plan' and product_key = 'pro' and currency = 'USD';
update plans set monthly_credits = 2500, max_projects = 40 where plan_key = 'pro';
update plans set ai_features = array_append(ai_features, 'pdf_qa') where plan_key = 'free';
update credit_packs set expiry_days = 180 where pack_key = 'credits_2000';
-- estimated payment fee used in the admin margin (check your merchant agreement)
update billing_settings set value_num = 3.8 where key = 'payment_fee_pct';
```

Refunds are made in the Flutterwave dashboard, then recorded here so credits or the subscription are removed:
`select billing_refund_payment('<payment id>', 'reason');`

## Economics (initial proposals, to validate)

At the default `credit_value_micro_usd = 1000`, 2,000 credits is about $2.00 of AI cost. A $7.99 Pro month leaves about $5.99 before payment fees. The admin page shows revenue, AI cost and an *estimated* margin (USD payments only, fee percentage from `billing_settings`). Purchased credits are not a cost until used, so margin on pack sales is a moving estimate. Validate prices against real usage before treating them as final.

## What has and has not been verified

Verified by automated tests on a scratch Postgres and with mocked Flutterwave responses: credit pools, reservation, charging order, expiry, concurrency, idempotent fulfilment, amount and currency checks, plan gating, project limits, privileges, webhook authentication, route behaviour, and that the existing 55-test ledger suite still passes unchanged.

**Not verified:** a real Flutterwave test-mode transaction (needs your keys), the redirect-return flow end to end, Mobile Money, and the response shape of `verify_by_reference` on your account (the primary path verifies by transaction id, which is documented).
